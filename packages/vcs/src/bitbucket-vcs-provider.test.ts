import { describe, expect, it } from 'vitest';
import { WardenError, type VcsRepoRef } from '@warden/core';
import { BitbucketVcsProvider } from './bitbucket-vcs-provider.js';
import { routerFetch } from './test-fetch.js';

const repo: VcsRepoRef = { host: 'bitbucket', owner: 'workspace', repo: 'checkout' };
const BASE = 'https://api.bitbucket.org/2.0/repositories/workspace/checkout';

describe('BitbucketVcsProvider', () => {
  it('fetches and maps a pull request', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({
      body: {
        id: 11,
        title: 'PR',
        draft: false,
        links: { html: { href: 'https://bitbucket.org/workspace/checkout/pull-requests/11' } },
        source: { commit: { hash: 'headhash' }, branch: { name: 'feature/x' } },
        destination: { commit: { hash: 'basehash' }, branch: { name: 'main' } },
        author: { nickname: 'dev' },
      },
    }));
    const provider = new BitbucketVcsProvider({ token: 't', fetchImpl });

    const pr = await provider.getPullRequest(repo, 11);

    expect(calls[0]!.url).toBe(`${BASE}/pullrequests/11`);
    expect(calls[0]!.headers.Authorization).toBe('Bearer t');
    expect(pr).toMatchObject({
      number: 11,
      headSha: 'headhash',
      headRef: 'feature/x',
      baseSha: 'basehash',
      baseRef: 'main',
      author: 'dev',
      draft: false,
    });
  });

  it('maps the diffstat endpoint to DiffFile[]', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({
      body: {
        values: [
          { status: 'added', lines_added: 3, lines_removed: 0, new: { path: 'a.ts' }, old: null },
          { status: 'removed', lines_added: 0, lines_removed: 4, new: null, old: { path: 'b.ts' } },
        ],
      },
    }));
    const provider = new BitbucketVcsProvider({ token: 't', fetchImpl });

    const diff = await provider.getDiff(repo, 11);

    expect(calls[0]!.url).toBe(`${BASE}/pullrequests/11/diffstat?pagelen=100&page=1`);
    expect(diff).toEqual([
      { path: 'a.ts', status: 'added', additions: 3, deletions: 0 },
      { path: 'b.ts', status: 'deleted', additions: 0, deletions: 4 },
    ]);
  });

  it('posts a PR comment with a raw content body', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new BitbucketVcsProvider({ token: 't', fetchImpl });

    await provider.postComment(repo, 11, 'hi');

    expect(calls[0]!.url).toBe(`${BASE}/pullrequests/11/comments`);
    expect(calls[0]!.body).toEqual({ content: { raw: 'hi' } });
  });

  it('posts a build status, mapping success -> SUCCESSFUL', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new BitbucketVcsProvider({ token: 't', fetchImpl });

    await provider.postStatus(repo, 'sha1', {
      context: 'warden-qa',
      state: 'success',
      title: 'Warden QA',
      summary: 'ok',
    });

    expect(calls[0]!.url).toBe(`${BASE}/commit/sha1/statuses/build`);
    expect(calls[0]!.body).toMatchObject({
      key: 'warden-qa',
      state: 'SUCCESSFUL',
      name: 'Warden QA',
      description: 'ok',
    });
  });

  it('opens a draft PR: creates the branch, commits via src, opens the PR', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/workspace/checkout')) {
        return { body: { mainbranch: { name: 'main' } } };
      }
      if (method === 'GET' && url.includes('/refs/branches/sync-branch')) return { status: 404 };
      if (method === 'GET' && url.includes('/refs/branches/main')) {
        return { body: { target: { hash: 'basehash' } } };
      }
      if (method === 'POST' && url.endsWith('/refs/branches')) return { body: {} };
      if (method === 'POST' && url.endsWith('/src')) return { body: {} };
      if (method === 'GET' && url.includes('/pullrequests?q=')) return { body: { values: [] } };
      if (method === 'POST' && url.endsWith('/pullrequests')) {
        return { body: { id: 4, links: { html: { href: 'https://bitbucket.org/pr/4' } } } };
      }
      return { status: 500, body: { url } };
    });
    const provider = new BitbucketVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [{ path: 'tests/new.spec.ts', content: 'ADD' }],
    });

    expect(result).toEqual({ number: 4, url: 'https://bitbucket.org/pr/4' });
    const src = calls.find((c) => c.url.endsWith('/src'))!;
    expect(src.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(src.raw).toContain('branch=sync-branch');
    expect(src.raw).toContain(encodeURIComponent('tests/new.spec.ts'));
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pullrequests'))!;
    expect(create.body).toMatchObject({
      source: { branch: { name: 'sync-branch' } },
      destination: { branch: { name: 'main' } },
      draft: true,
    });
  });

  it('updates the existing open PR by source branch', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/workspace/checkout')) {
        return { body: { mainbranch: { name: 'main' } } };
      }
      if (method === 'GET' && url.includes('/refs/branches/sync-branch')) {
        return { body: { target: { hash: 'x' } } };
      }
      if (method === 'POST' && url.endsWith('/src')) return { body: {} };
      if (method === 'GET' && url.includes('/pullrequests?q=')) {
        return {
          body: { values: [{ id: 8, links: { html: { href: 'https://bitbucket.org/pr/8' } } }] },
        };
      }
      if (method === 'PUT' && url.includes('/pullrequests/8')) {
        return { body: { id: 8, links: { html: { href: 'https://bitbucket.org/pr/8' } } } };
      }
      return { body: {} };
    });
    const provider = new BitbucketVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [],
    });

    expect(result.number).toBe(8);
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/pullrequests/8'))).toBe(true);
  });

  it('throws a WardenError on a non-2xx response', async () => {
    const { fetchImpl } = routerFetch(() => ({ status: 500, text: 'boom' }));
    const provider = new BitbucketVcsProvider({ token: 't', fetchImpl });
    await expect(provider.postComment(repo, 1, 'x')).rejects.toThrow(WardenError);
  });
});
