import { describe, expect, it } from 'vitest';
import {
  defineConfig,
  type CoverageRecommender,
  type DiffFile,
  type WardenConfig,
} from '@warden/core';
import { fakeProvider, fixtureChangeSurface } from '@warden/core/testing';
import { run, type PullRequestEvent } from './app.js';
import { fakeOctokit, httpError } from './test-fakes.js';

const event: PullRequestEvent = {
  action: 'opened',
  installation: { id: 555 },
  repository: { name: 'checkout', full_name: 'org/checkout', owner: { login: 'org' } },
  pull_request: { number: 42, head: { sha: 'headsha', ref: 'feature/pay' }, base: { ref: 'main' } },
};

const diff: DiffFile[] = [
  { path: 'services/checkout/pay.ts', status: 'modified' },
  { path: 'services/checkout/legacy.ts', status: 'deleted' },
];

/** A stub recommender: fixed recs across an external repo + `self`. */
const recommender: CoverageRecommender = {
  async recommend() {
    return [
      {
        kind: 'test',
        action: 'add',
        targetRepo: 'org/e2e-tests',
        path: 'tests/checkout.spec.ts',
        reason: 'new route',
        content: 'ADD',
      },
      {
        kind: 'test',
        action: 'remove',
        targetRepo: 'org/e2e-tests',
        path: 'tests/legacy.spec.ts',
        reason: 'route removed',
        patch: 'DEL',
      },
      {
        kind: 'doc',
        action: 'update',
        targetRepo: 'self',
        path: 'docs/checkout.md',
        reason: 'behavior changed',
        content: 'DOC',
      },
    ];
  },
};

/** A router that serves both the octokit FileAccess reads and the GitHubAccess writes. */
function router(route: string, params: Record<string, unknown>): { data?: unknown } {
  switch (route) {
    case 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}':
      return params.repo === 'e2e-tests'
        ? { data: { tree: [{ path: 'tests/legacy.spec.ts', type: 'blob' }] } }
        : { data: { tree: [{ path: 'docs/intro.md', type: 'blob' }] } };
    case 'GET /repos/{owner}/{repo}':
      return { data: { default_branch: 'main' } };
    case 'GET /repos/{owner}/{repo}/git/ref/{ref}':
      if (params.ref === 'heads/main') return { data: { object: { sha: 'basesha' } } };
      throw httpError(404); // sync branch missing → create it
    case 'POST /repos/{owner}/{repo}/git/refs':
      return { data: {} };
    case 'GET /repos/{owner}/{repo}/contents/{path}':
      if (params.path === 'tests/legacy.spec.ts') return { data: { sha: 'legacysha' } };
      throw httpError(404);
    case 'PUT /repos/{owner}/{repo}/contents/{path}':
    case 'DELETE /repos/{owner}/{repo}/contents/{path}':
      return { data: {} };
    case 'GET /repos/{owner}/{repo}/pulls':
      return { data: [] };
    case 'POST /repos/{owner}/{repo}/pulls':
      return { data: { number: 101, html_url: 'https://github.com/org/e2e-tests/pull/101' } };
    case 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments':
      return { data: {} };
    case 'POST /repos/{owner}/{repo}/check-runs':
      return { data: {} };
    default:
      throw httpError(500, `unexpected ${route} ${JSON.stringify(params)}`);
  }
}

describe('run', () => {
  it('drives the pipeline into a draft PR, self suggestions, and a check run', async () => {
    const octokit = fakeOctokit(router);
    const cfg: WardenConfig = defineConfig({
      links: {
        testRepos: [{ repo: 'org/e2e-tests', pathPrefix: 'tests/', mapping: 'by-path' }],
        docRepos: [{ repo: 'self', pathPrefix: 'docs/' }],
        dependents: [],
      },
    });

    const summary = await run({
      event,
      octokitFor: () => octokit,
      loadConfig: async () => cfg,
      fetchDiff: async () => diff,
      recommender,
      provider: fakeProvider(),
      computeChangeSurface: () =>
        fixtureChangeSurface({
          changedModules: ['checkout'],
          affectedApiRoutes: [],
          affectedComponents: [],
          changedFiles: ['services/checkout/pay.ts'],
        }),
    });

    expect(summary.status).toBe('published');
    expect(summary.draftPrs).toEqual([
      { repo: 'org/e2e-tests', url: 'https://github.com/org/e2e-tests/pull/101', number: 101 },
    ]);
    expect(summary.selfSuggested).toBe(1);
    expect(summary.checkPosted).toBe(true);

    const routes = octokit.calls.map((c) => c.route);

    // A draft PR was opened on the deterministic sync branch for the target repo.
    const prCall = octokit.calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/pulls')!;
    expect(prCall.params).toMatchObject({
      draft: true,
      head: 'warden/sync-org-e2e-tests-pr-42',
      base: 'main',
    });

    // The removed test was committed as a deletion.
    expect(routes).toContain('DELETE /repos/{owner}/{repo}/contents/{path}');

    // The self doc recommendation posted a comment on the source PR.
    const comment = octokit.calls.find(
      (c) => c.route === 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
    )!;
    expect(comment.params).toMatchObject({ repo: 'checkout', issue_number: 42 });

    // A success check run was posted to the source PR head.
    const check = octokit.calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/check-runs')!;
    expect(check.params).toMatchObject({ conclusion: 'success', head_sha: 'headsha' });
  });

  it('no-ops on an unhandled pull_request action', async () => {
    const octokit = fakeOctokit(() => {
      throw new Error('octokit should not be called for a no-op');
    });

    const summary = await run({
      event: { ...event, action: 'closed' },
      octokitFor: () => octokit,
      loadConfig: async () => defineConfig(),
      fetchDiff: async () => diff,
    });

    expect(summary.status).toBe('no-gaps');
    expect(summary.draftPrs).toHaveLength(0);
    expect(octokit.calls).toHaveLength(0);
  });
});
