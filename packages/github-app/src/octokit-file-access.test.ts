import { describe, expect, it } from 'vitest';
import { createOctokitFileAccess } from './octokit-file-access.js';
import { fakeOctokit, httpError } from './test-fakes.js';

describe('createOctokitFileAccess', () => {
  it('lists only blobs under a dir via the recursive git trees API', async () => {
    const octokit = fakeOctokit((route) => {
      if (route === 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}') {
        return {
          data: {
            tree: [
              { path: 'tests', type: 'tree' },
              { path: 'tests/b.spec.ts', type: 'blob' },
              { path: 'tests/a.spec.ts', type: 'blob' },
              { path: 'src/x.ts', type: 'blob' },
            ],
          },
        };
      }
      throw httpError(500, `unexpected ${route}`);
    });

    const fa = createOctokitFileAccess(octokit, 'org/e2e-tests', 'HEAD');
    const files = await fa.listFiles('tests');

    expect(files).toEqual(['tests/a.spec.ts', 'tests/b.spec.ts']);
    expect(octokit.calls[0]).toEqual({
      route: 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}',
      params: { owner: 'org', repo: 'e2e-tests', tree_sha: 'HEAD', recursive: '1' },
    });
  });

  it('lists the whole tree for an empty dir', async () => {
    const octokit = fakeOctokit(() => ({
      data: {
        tree: [
          { path: 'a', type: 'blob' },
          { path: 'b/c', type: 'blob' },
        ],
      },
    }));
    const fa = createOctokitFileAccess(octokit, 'org/svc', 'main');
    expect(await fa.listFiles('')).toEqual(['a', 'b/c']);
  });

  it('reads and base64-decodes a file via the contents API', async () => {
    const octokit = fakeOctokit((route) => {
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
        return {
          data: {
            // GitHub returns base64 with embedded newlines.
            content: `${Buffer.from('hello world', 'utf8').toString('base64')}\n`,
            encoding: 'base64',
          },
        };
      }
      throw httpError(500, `unexpected ${route}`);
    });

    const fa = createOctokitFileAccess(octokit, 'org/svc', 'sha123');
    expect(await fa.readFile('docs/readme.md')).toBe('hello world');
    expect(octokit.calls[0]!.params).toEqual({
      owner: 'org',
      repo: 'svc',
      path: 'docs/readme.md',
      ref: 'sha123',
    });
  });

  it('returns null when a file is missing (404)', async () => {
    const octokit = fakeOctokit(() => {
      throw httpError(404, 'Not Found');
    });
    const fa = createOctokitFileAccess(octokit, 'org/svc', 'main');
    expect(await fa.readFile('missing.md')).toBeNull();
  });

  it('rethrows non-404 read errors', async () => {
    const octokit = fakeOctokit(() => {
      throw httpError(500, 'boom');
    });
    const fa = createOctokitFileAccess(octokit, 'org/svc', 'main');
    await expect(fa.readFile('x.md')).rejects.toThrow('boom');
  });
});
