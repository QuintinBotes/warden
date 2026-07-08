import { describe, expect, it } from 'vitest';
import { WardenError, type VcsRepoRef } from '@warden/core';
import { GitHubVcsProvider } from './github-vcs-provider.js';
import { routerFetch } from './test-fetch.js';

const repo: VcsRepoRef = { host: 'github', owner: 'acme', repo: 'checkout' };

describe('GitHubVcsProvider', () => {
  it('fetches and maps a pull request', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({
      body: {
        number: 42,
        title: 'Add checkout',
        html_url: 'https://github.com/acme/checkout/pull/42',
        draft: true,
        head: { sha: 'headsha', ref: 'feature/x' },
        base: { sha: 'basesha', ref: 'main' },
        user: { login: 'octo' },
      },
    }));
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    const pr = await provider.getPullRequest(repo, 42);

    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/checkout/pulls/42');
    expect(calls[0]!.headers.Authorization).toBe('Bearer t');
    expect(pr).toEqual({
      number: 42,
      title: 'Add checkout',
      url: 'https://github.com/acme/checkout/pull/42',
      headSha: 'headsha',
      headRef: 'feature/x',
      baseSha: 'basesha',
      baseRef: 'main',
      author: 'octo',
      draft: true,
    });
  });

  it('fetches and maps the diff to DiffFile[]', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({
      body: [
        { filename: 'a.ts', status: 'added', additions: 10, deletions: 0, patch: '@@ +a' },
        { filename: 'b.ts', status: 'removed', additions: 0, deletions: 5 },
        { filename: 'c.ts', status: 'modified', additions: 1, deletions: 1 },
      ],
    }));
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    const diff = await provider.getDiff(repo, 42);

    expect(calls[0]!.url).toBe(
      'https://api.github.com/repos/acme/checkout/pulls/42/files?per_page=100&page=1',
    );
    expect(diff).toEqual([
      { path: 'a.ts', status: 'added', additions: 10, deletions: 0, patch: '@@ +a' },
      { path: 'b.ts', status: 'deleted', additions: 0, deletions: 5 },
      { path: 'c.ts', status: 'modified', additions: 1, deletions: 1 },
    ]);
  });

  it('posts a PR comment to the issues endpoint', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    await provider.postComment(repo, 42, 'hello');

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/checkout/issues/42/comments');
    expect(calls[0]!.body).toEqual({ body: 'hello' });
  });

  it('posts a completed check run for a terminal state', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    await provider.postStatus(repo, 'abc123', {
      context: 'warden-qa',
      state: 'failure',
      title: 'Warden QA',
      summary: 'blocked',
    });

    expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/checkout/check-runs');
    expect(calls[0]!.body).toMatchObject({
      name: 'warden-qa',
      head_sha: 'abc123',
      status: 'completed',
      conclusion: 'failure',
      output: { title: 'Warden QA', summary: 'blocked' },
    });
  });

  it('posts an in-progress check run for a pending state (no conclusion)', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    await provider.postStatus(repo, 'abc', {
      context: 'warden-qa',
      state: 'pending',
      title: 't',
      summary: 's',
    });

    expect(calls[0]!.body).toMatchObject({ status: 'in_progress' });
    expect((calls[0]!.body as Record<string, unknown>).conclusion).toBeUndefined();
  });

  it('opens a draft PR: creates the branch, commits files, opens the PR', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/repos/acme/checkout')) {
        return { body: { default_branch: 'main' } };
      }
      if (method === 'GET' && url.includes('/git/ref/heads/sync-branch')) return { status: 404 };
      if (method === 'GET' && url.includes('/git/ref/heads/main')) {
        return { body: { object: { sha: 'basesha' } } };
      }
      if (method === 'POST' && url.endsWith('/git/refs')) return { body: {} };
      if (method === 'GET' && url.includes('/contents/tests/new.spec.ts')) return { status: 404 };
      if (method === 'PUT' && url.includes('/contents/')) return { body: {} };
      if (method === 'GET' && url.includes('/pulls?head=')) return { body: [] };
      if (method === 'POST' && url.endsWith('/pulls')) {
        return { body: { number: 7, html_url: 'https://github.com/acme/checkout/pull/7' } };
      }
      return { status: 500, body: { unexpected: url } };
    });
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [{ path: 'tests/new.spec.ts', content: 'ADD' }],
    });

    expect(result).toEqual({ number: 7, url: 'https://github.com/acme/checkout/pull/7' });

    const refCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/refs'))!;
    expect(refCall.body).toMatchObject({ ref: 'refs/heads/sync-branch', sha: 'basesha' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toMatchObject({
      branch: 'sync-branch',
      content: Buffer.from('ADD', 'utf8').toString('base64'),
    });
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'))!;
    expect(post.body).toMatchObject({ head: 'sync-branch', base: 'main', draft: true });
  });

  it('updates the existing open PR instead of creating a duplicate', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/repos/acme/checkout')) {
        return { body: { default_branch: 'main' } };
      }
      if (method === 'GET' && url.includes('/git/ref/heads/sync-branch')) {
        return { body: { object: { sha: 'exists' } } };
      }
      if (method === 'GET' && url.includes('/pulls?head=')) {
        return { body: [{ number: 9, html_url: 'https://github.com/acme/checkout/pull/9' }] };
      }
      if (method === 'PATCH' && url.includes('/pulls/9')) {
        return { body: { number: 9, html_url: 'https://github.com/acme/checkout/pull/9' } };
      }
      return { body: {} };
    });
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [],
    });

    expect(result.number).toBe(9);
    expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/pulls/9'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(false);
  });

  it('respects a custom baseUrl (GitHub Enterprise Server)', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new GitHubVcsProvider({
      token: 't',
      baseUrl: 'https://ghe.example.com/api/v3',
      fetchImpl,
    });

    await provider.postComment(repo, 1, 'x');

    expect(calls[0]!.url).toBe(
      'https://ghe.example.com/api/v3/repos/acme/checkout/issues/1/comments',
    );
  });

  it('throws a WardenError on a non-2xx response', async () => {
    const { fetchImpl } = routerFetch(() => ({ status: 403, text: 'Forbidden' }));
    const provider = new GitHubVcsProvider({ token: 't', fetchImpl });

    await expect(provider.postComment(repo, 1, 'x')).rejects.toThrow(WardenError);
  });
});
