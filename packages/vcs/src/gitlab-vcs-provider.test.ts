import { describe, expect, it } from 'vitest';
import { WardenError, type VcsRepoRef } from '@warden/core';
import { GitLabVcsProvider } from './gitlab-vcs-provider.js';
import { routerFetch } from './test-fetch.js';

const repo: VcsRepoRef = { host: 'gitlab', owner: 'group/sub', repo: 'checkout' };
const PROJECT = encodeURIComponent('group/sub/checkout');

describe('GitLabVcsProvider', () => {
  it('fetches and maps a merge request', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({
      body: {
        iid: 7,
        title: 'MR',
        web_url: 'https://gitlab.com/group/sub/checkout/-/merge_requests/7',
        source_branch: 'feature/x',
        target_branch: 'main',
        draft: true,
        author: { username: 'dev' },
        diff_refs: { base_sha: 'base', head_sha: 'head' },
      },
    }));
    const provider = new GitLabVcsProvider({ token: 't', fetchImpl });

    const pr = await provider.getPullRequest(repo, 7);

    expect(calls[0]!.url).toBe(`https://gitlab.com/api/v4/projects/${PROJECT}/merge_requests/7`);
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('t');
    expect(pr).toMatchObject({
      number: 7,
      headSha: 'head',
      headRef: 'feature/x',
      baseSha: 'base',
      baseRef: 'main',
      author: 'dev',
      draft: true,
    });
  });

  it('maps the diffs endpoint to DiffFile[]', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({
      body: [
        { old_path: 'a.ts', new_path: 'a.ts', new_file: true, diff: '@@ +a' },
        { old_path: 'b.ts', new_path: 'b.ts', deleted_file: true },
        { old_path: 'c.ts', new_path: 'd.ts', renamed_file: true },
      ],
    }));
    const provider = new GitLabVcsProvider({ token: 't', fetchImpl });

    const diff = await provider.getDiff(repo, 7);

    expect(calls[0]!.url).toBe(
      `https://gitlab.com/api/v4/projects/${PROJECT}/merge_requests/7/diffs?per_page=100&page=1`,
    );
    expect(diff).toEqual([
      { path: 'a.ts', status: 'added', patch: '@@ +a' },
      { path: 'b.ts', status: 'deleted' },
      { path: 'd.ts', status: 'renamed' },
    ]);
  });

  it('posts an MR note for a comment', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new GitLabVcsProvider({ token: 't', fetchImpl });

    await provider.postComment(repo, 7, 'hi');

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(
      `https://gitlab.com/api/v4/projects/${PROJECT}/merge_requests/7/notes`,
    );
    expect(calls[0]!.body).toEqual({ body: 'hi' });
  });

  it('posts a commit status, mapping failure -> failed', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = new GitLabVcsProvider({ token: 't', fetchImpl });

    await provider.postStatus(repo, 'sha1', {
      context: 'warden-qa',
      state: 'failure',
      title: 'Warden QA',
      summary: 's',
    });

    expect(calls[0]!.url).toBe(`https://gitlab.com/api/v4/projects/${PROJECT}/statuses/sha1`);
    expect(calls[0]!.body).toMatchObject({ state: 'failed', name: 'warden-qa' });
  });

  it('opens a draft MR: creates the branch, commits, and creates the MR', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith(`/projects/${PROJECT}`)) {
        return { body: { default_branch: 'main' } };
      }
      if (method === 'GET' && url.includes('/repository/branches/sync-branch'))
        return { status: 404 };
      if (method === 'POST' && url.includes('/repository/branches?')) return { body: {} };
      if (method === 'GET' && url.includes('/repository/files/')) return { status: 404 };
      if (method === 'POST' && url.endsWith('/repository/commits')) return { body: {} };
      if (method === 'GET' && url.includes('/merge_requests?source_branch=')) return { body: [] };
      if (method === 'POST' && url.endsWith('/merge_requests')) {
        return { body: { iid: 3, web_url: 'https://gitlab.com/mr/3' } };
      }
      return { status: 500, body: { url } };
    });
    const provider = new GitLabVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [{ path: 'tests/new.spec.ts', content: 'ADD' }],
    });

    expect(result).toEqual({ number: 3, url: 'https://gitlab.com/mr/3' });
    const commit = calls.find((c) => c.url.endsWith('/repository/commits'))!;
    expect(commit.body).toMatchObject({
      branch: 'sync-branch',
      actions: [{ action: 'create', file_path: 'tests/new.spec.ts', content: 'ADD' }],
    });
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/merge_requests'))!;
    expect(create.body).toMatchObject({
      source_branch: 'sync-branch',
      target_branch: 'main',
      title: 'Draft: Warden sync',
    });
  });

  it('updates the existing open MR by source branch', async () => {
    const { fetchImpl, calls } = routerFetch(({ method, url }) => {
      if (method === 'GET' && url.endsWith(`/projects/${PROJECT}`)) {
        return { body: { default_branch: 'main' } };
      }
      if (method === 'GET' && url.includes('/repository/branches/sync-branch')) {
        return { body: { name: 'sync-branch' } };
      }
      if (method === 'GET' && url.includes('/merge_requests?source_branch=')) {
        return { body: [{ iid: 5, web_url: 'https://gitlab.com/mr/5' }] };
      }
      if (method === 'PUT' && url.includes('/merge_requests/5')) {
        return { body: { iid: 5, web_url: 'https://gitlab.com/mr/5' } };
      }
      return { body: {} };
    });
    const provider = new GitLabVcsProvider({ token: 't', fetchImpl });

    const result = await provider.openDraftPr({
      repo,
      branch: 'sync-branch',
      title: 'Warden sync',
      body: 'body',
      files: [],
    });

    expect(result.number).toBe(5);
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/merge_requests/5'))).toBe(true);
  });

  it('throws a WardenError on a non-2xx response', async () => {
    const { fetchImpl } = routerFetch(() => ({ status: 401, text: 'unauth' }));
    const provider = new GitLabVcsProvider({ token: 't', fetchImpl });
    await expect(provider.postComment(repo, 1, 'x')).rejects.toThrow(WardenError);
  });
});
