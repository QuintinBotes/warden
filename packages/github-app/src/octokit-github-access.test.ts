import { describe, expect, it } from 'vitest';
import type { PrRef } from '@warden/core';
import { createOctokitGitHubAccess } from './octokit-github-access.js';
import { fakeOctokit, httpError } from './test-fakes.js';

const pr: PrRef = { owner: 'org', repo: 'checkout', number: 42, headSha: 'abc', headRef: 'feat' };

describe('createOctokitGitHubAccess', () => {
  it('creates the branch, commits files (add + delete), and opens a draft PR', async () => {
    const octokit = fakeOctokit((route, params) => {
      switch (route) {
        case 'GET /repos/{owner}/{repo}':
          return { data: { default_branch: 'main' } };
        case 'GET /repos/{owner}/{repo}/git/ref/{ref}':
          if (params.ref === 'heads/main') return { data: { object: { sha: 'basesha' } } };
          throw httpError(404); // the sync branch does not exist yet
        case 'POST /repos/{owner}/{repo}/git/refs':
          return { data: {} };
        case 'GET /repos/{owner}/{repo}/contents/{path}':
          if (params.path === 'tests/legacy.spec.ts') return { data: { sha: 'oldsha' } };
          throw httpError(404); // the added file does not exist yet
        case 'PUT /repos/{owner}/{repo}/contents/{path}':
        case 'DELETE /repos/{owner}/{repo}/contents/{path}':
          return { data: {} };
        case 'GET /repos/{owner}/{repo}/pulls':
          return { data: [] }; // none open
        case 'POST /repos/{owner}/{repo}/pulls':
          return { data: { number: 7, html_url: 'https://github.com/org/e2e/pull/7' } };
        default:
          throw httpError(500, `unexpected ${route}`);
      }
    });

    const gh = createOctokitGitHubAccess(octokit);
    const result = await gh.openOrUpdateDraftPr(
      'org/e2e',
      'warden/sync-org-checkout-pr-42',
      [
        { path: 'tests/new.spec.ts', content: 'ADD' },
        { path: 'tests/legacy.spec.ts', content: null },
      ],
      'Warden sync',
      'body',
    );

    expect(result).toEqual({ number: 7, url: 'https://github.com/org/e2e/pull/7' });

    const find = (route: string) => octokit.calls.filter((c) => c.route === route);

    // Branch created off the default branch tip.
    expect(find('POST /repos/{owner}/{repo}/git/refs')[0]!.params).toMatchObject({
      owner: 'org',
      repo: 'e2e',
      ref: 'refs/heads/warden/sync-org-checkout-pr-42',
      sha: 'basesha',
    });

    // New file committed as a base64 PUT with no sha.
    const put = find('PUT /repos/{owner}/{repo}/contents/{path}')[0]!;
    expect(put.params).toMatchObject({
      path: 'tests/new.spec.ts',
      branch: 'warden/sync-org-checkout-pr-42',
      content: Buffer.from('ADD', 'utf8').toString('base64'),
    });
    expect(put.params.sha).toBeUndefined();

    // Existing file deleted using its blob sha.
    expect(find('DELETE /repos/{owner}/{repo}/contents/{path}')[0]!.params).toMatchObject({
      path: 'tests/legacy.spec.ts',
      branch: 'warden/sync-org-checkout-pr-42',
      sha: 'oldsha',
    });

    // Draft PR opened against the default branch.
    expect(find('POST /repos/{owner}/{repo}/pulls')[0]!.params).toMatchObject({
      title: 'Warden sync',
      head: 'warden/sync-org-checkout-pr-42',
      base: 'main',
      draft: true,
    });
  });

  it('updates the existing open PR instead of opening a new one (idempotent)', async () => {
    const octokit = fakeOctokit((route) => {
      switch (route) {
        case 'GET /repos/{owner}/{repo}':
          return { data: { default_branch: 'main' } };
        case 'GET /repos/{owner}/{repo}/git/ref/{ref}':
          return { data: { object: { sha: 'sha' } } }; // branch already exists
        case 'GET /repos/{owner}/{repo}/contents/{path}':
          throw httpError(404);
        case 'PUT /repos/{owner}/{repo}/contents/{path}':
          return { data: {} };
        case 'GET /repos/{owner}/{repo}/pulls':
          return { data: [{ number: 9, html_url: 'existing-url' }] };
        case 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}':
          return { data: { number: 9, html_url: 'existing-url' } };
        default:
          throw httpError(500, `unexpected ${route}`);
      }
    });

    const gh = createOctokitGitHubAccess(octokit);
    const result = await gh.openOrUpdateDraftPr(
      'org/e2e',
      'br',
      [{ path: 'a.spec.ts', content: 'x' }],
      'title',
      'body',
    );

    expect(result).toEqual({ number: 9, url: 'existing-url' });
    expect(octokit.calls.some((c) => c.route === 'POST /repos/{owner}/{repo}/git/refs')).toBe(
      false,
    );
    expect(octokit.calls.some((c) => c.route === 'POST /repos/{owner}/{repo}/pulls')).toBe(false);
    expect(
      octokit.calls.find((c) => c.route === 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}')!
        .params,
    ).toMatchObject({ pull_number: 9, title: 'title', body: 'body' });
  });

  it('posts PR suggestions as a comment on the source PR', async () => {
    const octokit = fakeOctokit(() => ({ data: {} }));
    const gh = createOctokitGitHubAccess(octokit);

    await gh.addPrSuggestions(pr, [{ path: 'docs/x.md', content: 'DOC-BODY' }], 'the summary');

    const call = octokit.calls[0]!;
    expect(call.route).toBe('POST /repos/{owner}/{repo}/issues/{issue_number}/comments');
    expect(call.params).toMatchObject({ owner: 'org', repo: 'checkout', issue_number: 42 });
    const body = String(call.params.body);
    expect(body).toContain('the summary');
    expect(body).toContain('docs/x.md');
    expect(body).toContain('DOC-BODY');
  });

  it('posts a completed check run carrying the conclusion + output', async () => {
    const octokit = fakeOctokit(() => ({ data: {} }));
    const gh = createOctokitGitHubAccess(octokit);

    await gh.postCheckRun(pr, 'success', 'Coverage', 'all good');

    const call = octokit.calls[0]!;
    expect(call.route).toBe('POST /repos/{owner}/{repo}/check-runs');
    expect(call.params).toMatchObject({
      owner: 'org',
      repo: 'checkout',
      head_sha: 'abc',
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Coverage', summary: 'all good' },
    });
  });
});
