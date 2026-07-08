import type { FileAccess } from '@warden/core';

/**
 * The minimal slice of an octokit client the App's adapters actually call. The
 * real `@octokit/rest` / installation octokit satisfies this structurally; unit
 * tests inject a recording fake so no real network is ever touched.
 */
export interface OctokitResponse {
  status: number;
  // The GitHub REST payloads are large and route-specific; adapters narrow the
  // shape at each call site, so `any` here keeps the seam ergonomic.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface OctokitLike {
  request(route: string, params?: Record<string, unknown>): Promise<OctokitResponse>;
}

/** Split an `owner/repo` string into its parts, throwing on a malformed value. */
export function splitRepo(repo: string): { owner: string; repo: string } {
  const idx = repo.indexOf('/');
  if (idx <= 0 || idx === repo.length - 1) {
    throw new Error(`invalid repo "${repo}", expected "owner/repo"`);
  }
  return { owner: repo.slice(0, idx), repo: repo.slice(idx + 1) };
}

/** The HTTP status carried by an octokit request error, if any. */
export function errorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/**
 * A read-only {@link FileAccess} over the GitHub REST API, pinned to one `repo`
 * (`owner/repo`) and `ref` (a sha, branch, or `HEAD`).
 *
 * - `listFiles(dir)` uses the recursive git trees API and keeps only blobs whose
 *   path is at or under `dir` (a `''` prefix lists the whole tree). Paths are sorted.
 * - `readFile(path)` uses the contents API, base64-decodes the payload, and returns
 *   `null` when the file does not exist (a 404).
 */
export function createOctokitFileAccess(
  octokit: OctokitLike,
  repo: string,
  ref: string,
): FileAccess {
  const { owner, repo: name } = splitRepo(repo);

  return {
    async listFiles(dir: string): Promise<string[]> {
      const res = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner,
        repo: name,
        tree_sha: ref,
        recursive: '1',
      });
      const tree: Array<{ path?: string; type?: string }> = res.data?.tree ?? [];
      const prefix = dir === '' ? '' : dir.endsWith('/') ? dir : `${dir}/`;
      return tree
        .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
        .map((entry) => entry.path as string)
        .filter((path) => prefix === '' || path === dir || path.startsWith(prefix))
        .sort();
    },

    async readFile(path: string): Promise<string | null> {
      try {
        const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner,
          repo: name,
          path,
          ref,
        });
        const { content, encoding } = res.data ?? {};
        if (typeof content !== 'string') return null;
        if (encoding && encoding !== 'base64') return content;
        return Buffer.from(content, 'base64').toString('utf8');
      } catch (err) {
        if (errorStatus(err) === 404) return null;
        throw err;
      }
    },
  };
}
