import { describe, expect, it } from 'vitest';
import { WardenError, type VcsRepoRef } from '@warden/core';
import { AzureDevOpsVcsProvider } from './azure-devops-vcs-provider.js';
import { routerFetch } from './test-fetch.js';

const repo: VcsRepoRef = { host: 'azure-devops', owner: 'org', project: 'proj', repo: 'checkout' };
const BASE = 'https://dev.azure.com/org/proj/_apis/git/repositories/checkout';

describe('AzureDevOpsVcsProvider', () => {
  it('fetches and maps a pull request', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({
      body: {
        pullRequestId: 21,
        title: 'PR',
        isDraft: true,
        sourceRefName: 'refs/heads/feature/x',
        targetRefName: 'refs/heads/main',
        lastMergeSourceCommit: { commitId: 'head' },
        lastMergeTargetCommit: { commitId: 'base' },
        createdBy: { uniqueName: 'dev@x' },
        repository: { webUrl: 'https://dev.azure.com/org/proj/_git/checkout' },
      },
    }));
    const provider = new AzureDevOpsVcsProvider({ token: 't', fetchImpl });

    const pr = await provider.getPullRequest(repo, 21);

    expect(calls[0]!.url).toBe(`${BASE}/pullrequests/21?api-version=7.1`);
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from(':t').toString('base64')}`);
    expect(pr).toMatchObject({
      number: 21,
      title: 'PR',
      headSha: 'head',
      headRef: 'feature/x',
      baseSha: 'base',
      baseRef: 'main',
      author: 'dev@x',
      draft: true,
      url: 'https://dev.azure.com/org/proj/_git/checkout/pullrequest/21',
    });
  });

  it('maps PR iteration changes to DiffFile[]', async () => {
    const { fetchImpl, calls } = routerFetch(({ url }) => {
      if (url.includes('/iterations?')) return { body: { value: [{ id: 1 }, { id: 2 }] } };
      if (url.includes('/iterations/2/changes')) {
        return {
          body: {
            changeEntries: [
              { changeType: 'add', item: { path: '/a.ts' } },
              { changeType: 'edit', item: { path: '/b.ts' } },
              { changeType: 'delete', item: { path: '/c.ts' } },
            ],
          },
        };
      }
      return { body: {} };
    });
    const provider = new AzureDevOpsVcsProvider({ token: 't', fetchImpl });

    const diff = await provider.getDiff(repo, 21);

    expect(calls[0]!.url).toBe(`${BASE}/pullRequests/21/iterations?api-version=7.1`);
    expect(calls[1]!.url).toBe(`${BASE}/pullRequests/21/iterations/2/changes?api-version=7.1`);
    expect(diff).toEqual([
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'modified' },
      { path: 'c.ts', status: 'deleted' },
    ]);
  });

  it('posts a thread comment', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new AzureDevOpsVcsProvider({ token: 't', fetchImpl });

    await provider.postComment(repo, 21, 'hi');

    expect(calls[0]!.url).toBe(`${BASE}/pullRequests/21/threads?api-version=7.1`);
    expect(calls[0]!.body).toMatchObject({
      comments: [{ parentCommentId: 0, content: 'hi', commentType: 1 }],
    });
  });

  it('posts a commit status, mapping failure -> failed', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new AzureDevOpsVcsProvider({ token: 't', fetchImpl });

    await provider.postStatus(repo, 'sha1', {
      context: 'warden-qa',
      state: 'failure',
      title: 'Warden QA',
      summary: 'blocked',
    });

    expect(calls[0]!.url).toBe(`${BASE}/commits/sha1/statuses?api-version=7.1`);
    expect(calls[0]!.body).toMatchObject({
      state: 'failed',
      description: 'blocked',
      context: { name: 'warden-qa', genre: 'warden' },
    });
  });

  it('honors a custom apiVersion pin', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new AzureDevOpsVcsProvider({ token: 't', apiVersion: '6.0', fetchImpl });

    await provider.postComment(repo, 1, 'x');

    expect(calls[0]!.url).toContain('api-version=6.0');
  });

  it('throws when the repo ref lacks a project', async () => {
    const { fetchImpl } = routerFetch(() => ({ body: {} }));
    const provider = new AzureDevOpsVcsProvider({ token: 't', fetchImpl });
    await expect(
      provider.getPullRequest({ host: 'azure-devops', owner: 'org', repo: 'checkout' }, 1),
    ).rejects.toThrow(WardenError);
  });

  it('opens a draft PR: creates the branch ref, pushes files, opens the PR', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && /repositories\/checkout\?api-version/.test(url)) {
        return { body: { defaultBranch: 'refs/heads/main', webUrl: `${BASE}` } };
      }
      if (method === 'GET' && url.includes('/refs?filter=heads/sync-branch')) {
        return { body: { value: [] } };
      }
      if (method === 'GET' && url.includes('/refs?filter=heads/main')) {
        return { body: { value: [{ name: 'refs/heads/main', objectId: 'baseoid' }] } };
      }
      if (method === 'POST' && url.includes('/refs?')) return { body: {} };
      if (method === 'GET' && url.includes('/items?')) return { status: 404 };
      if (method === 'POST' && url.includes('/pushes?')) return { body: {} };
      if (method === 'GET' && url.includes('/pullrequests?searchCriteria')) {
        return { body: { value: [] } };
      }
      if (method === 'POST' && url.includes('/pullrequests?')) {
        return { body: { pullRequestId: 12 } };
      }
      return { status: 500, body: { url } };
    });
    const provider = new AzureDevOpsVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [{ path: 'tests/new.spec.ts', content: 'ADD' }],
    });

    expect(result.number).toBe(12);
    expect(result.url).toBe('https://dev.azure.com/org/proj/_git/checkout/pullrequest/12');

    const refCreate = calls.find((c) => c.method === 'POST' && c.url.includes('/refs?'))!;
    expect(refCreate.body).toMatchObject([
      { name: 'refs/heads/sync-branch', newObjectId: 'baseoid' },
    ]);
    const push = calls.find((c) => c.url.includes('/pushes?'))!;
    expect(push.body).toMatchObject({
      refUpdates: [{ name: 'refs/heads/sync-branch', oldObjectId: 'baseoid' }],
      commits: [{ changes: [{ changeType: 'add', item: { path: 'tests/new.spec.ts' } }] }],
    });
    const create = calls.find((c) => c.method === 'POST' && c.url.includes('/pullrequests?'))!;
    expect(create.body).toMatchObject({
      sourceRefName: 'refs/heads/sync-branch',
      targetRefName: 'refs/heads/main',
      isDraft: true,
    });
  });

  it('updates the active PR by source ref instead of creating a duplicate', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && /repositories\/checkout\?api-version/.test(url)) {
        return { body: { defaultBranch: 'refs/heads/main' } };
      }
      if (method === 'GET' && url.includes('/refs?filter=heads/sync-branch')) {
        return { body: { value: [{ name: 'refs/heads/sync-branch', objectId: 'tip' }] } };
      }
      if (method === 'GET' && url.includes('/refs?filter=heads/main')) {
        return { body: { value: [{ name: 'refs/heads/main', objectId: 'baseoid' }] } };
      }
      if (method === 'GET' && url.includes('/pullrequests?searchCriteria')) {
        return { body: { value: [{ pullRequestId: 30 }] } };
      }
      if (method === 'PATCH' && url.includes('/pullrequests/30')) return { body: {} };
      return { body: {} };
    });
    const provider = new AzureDevOpsVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [],
    });

    expect(result.number).toBe(30);
    expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/pullrequests/30'))).toBe(
      true,
    );
  });
});
