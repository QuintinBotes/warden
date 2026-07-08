import { describe, expect, it } from 'vitest';
import type { PrRef } from '@warden/core';
import { createFakeVcsProvider } from './testing-fakes.js';
import { createGitHubAccessFromVcsProvider } from './github-access-bridge.js';

const pr: PrRef = { owner: 'org', repo: 'checkout', number: 42, headSha: 'abc', headRef: 'feat' };

describe('createGitHubAccessFromVcsProvider', () => {
  it('routes openOrUpdateDraftPr through provider.openDraftPr with a host-tagged repo ref', async () => {
    const fake = createFakeVcsProvider({ host: 'gitlab' });
    const gh = createGitHubAccessFromVcsProvider(fake);

    const result = await gh.openOrUpdateDraftPr(
      'org/e2e',
      'warden/sync-branch',
      [
        { path: 'tests/new.spec.ts', content: 'ADD' },
        { path: 'tests/old.spec.ts', content: null },
      ],
      'Warden sync',
      'body',
    );

    expect(result).toEqual({ url: 'https://example.test/org/e2e/pull/101', number: 101 });
    expect(fake.draftPrs).toHaveLength(1);
    expect(fake.draftPrs[0]).toMatchObject({
      repo: { host: 'gitlab', owner: 'org', repo: 'e2e' },
      branch: 'warden/sync-branch',
      title: 'Warden sync',
      files: [
        { path: 'tests/new.spec.ts', content: 'ADD' },
        { path: 'tests/old.spec.ts', content: null },
      ],
    });
  });

  it('routes postCheckRun through provider.postStatus', async () => {
    const fake = createFakeVcsProvider({ host: 'bitbucket' });
    const gh = createGitHubAccessFromVcsProvider(fake);

    await gh.postCheckRun(pr, 'failure', 'Coverage', 'summary text');

    expect(fake.statuses).toHaveLength(1);
    expect(fake.statuses[0]).toMatchObject({
      repo: { host: 'bitbucket', owner: 'org', repo: 'checkout' },
      headSha: 'abc',
      status: { context: 'warden-coverage-sync', state: 'failure', title: 'Coverage' },
    });
  });

  it('renders native inline suggestions on GitHub via postComment', async () => {
    const fake = createFakeVcsProvider({ host: 'github' });
    const gh = createGitHubAccessFromVcsProvider(fake);

    await gh.addPrSuggestions(pr, [{ path: 'a.ts', content: 'NEW' }], 'Proposed');

    expect(fake.comments).toHaveLength(1);
    const body = fake.comments[0]!.body;
    expect(fake.comments[0]!.prNumber).toBe(42);
    expect(body).toContain('```suggestion');
    expect(body).toContain('inline suggestions');
    expect(body).not.toContain('```diff');
  });

  it('falls back to a labeled fenced-diff comment on Bitbucket', async () => {
    const fake = createFakeVcsProvider({ host: 'bitbucket' });
    const gh = createGitHubAccessFromVcsProvider(fake);

    await gh.addPrSuggestions(pr, [{ path: 'a.ts', content: 'NEW' }], 'Proposed');

    const body = fake.comments[0]!.body;
    expect(body).toContain('```diff');
    expect(body).toContain('no inline-suggestion API');
    expect(body).not.toContain('```suggestion');
  });

  it('honors a custom renderSuggestion override', async () => {
    const fake = createFakeVcsProvider({ host: 'azure-devops' });
    const gh = createGitHubAccessFromVcsProvider(fake, {
      renderSuggestion: (files, host) => `custom:${host}:${files.map((f) => f.path).join(',')}`,
    });

    await gh.addPrSuggestions(pr, [{ path: 'a.ts', content: 'NEW' }], 'Proposed');

    expect(fake.comments[0]!.body).toBe('custom:azure-devops:a.ts');
  });

  it('passes the Azure DevOps project through to the repo ref', async () => {
    const fake = createFakeVcsProvider({ host: 'azure-devops' });
    const gh = createGitHubAccessFromVcsProvider(fake, { project: 'proj' });

    await gh.postCheckRun(pr, 'success', 'Coverage', 'ok');

    expect(fake.statuses[0]!.repo).toMatchObject({
      host: 'azure-devops',
      owner: 'org',
      repo: 'checkout',
      project: 'proj',
    });
  });
});
