import type { DraftPrResult, FileAccess, GitHubAccess, PrRef, RepoTarget } from '@warden/core';

/**
 * In-memory {@link FileAccess} backed by a `path -> contents` map.
 *
 * `listFiles(dir)` returns, sorted, every path at or under `dir` (a `''` prefix
 * lists the whole tree); `readFile(path)` returns the contents or `null`. Used
 * only by the package's own unit tests — never bundled into `dist`.
 */
export function memFileAccess(tree: Record<string, string>): FileAccess {
  const paths = Object.keys(tree);
  return {
    async listFiles(dir: string): Promise<string[]> {
      const prefix = dir === '' ? '' : dir.endsWith('/') ? dir : `${dir}/`;
      return paths
        .filter((path) => prefix === '' || path === dir || path.startsWith(prefix))
        .sort();
    },
    async readFile(path: string): Promise<string | null> {
      return Object.prototype.hasOwnProperty.call(tree, path) ? tree[path]! : null;
    },
  };
}

export interface DraftPrCall {
  repo: RepoTarget;
  branch: string;
  files: { path: string; content: string | null }[];
  title: string;
  body: string;
}

export interface SuggestionCall {
  pr: PrRef;
  files: { path: string; content: string }[];
  summary: string;
}

export interface CheckRunCall {
  pr: PrRef;
  conclusion: 'success' | 'neutral' | 'failure';
  title: string;
  summary: string;
}

export interface RecordingGitHubAccess extends GitHubAccess {
  draftPrCalls: DraftPrCall[];
  suggestionCalls: SuggestionCall[];
  checkRunCalls: CheckRunCall[];
}

/**
 * A recording {@link GitHubAccess} fake: it captures every call for assertions and
 * returns deterministic draft-PR results (`number` counts up from 100).
 */
export function recordingGitHub(): RecordingGitHubAccess {
  const draftPrCalls: DraftPrCall[] = [];
  const suggestionCalls: SuggestionCall[] = [];
  const checkRunCalls: CheckRunCall[] = [];

  return {
    draftPrCalls,
    suggestionCalls,
    checkRunCalls,
    async openOrUpdateDraftPr(repo, branch, files, title, body): Promise<DraftPrResult> {
      draftPrCalls.push({ repo, branch, files, title, body });
      const number = 100 + draftPrCalls.length;
      return { url: `https://github.com/${repo}/pull/${number}`, number };
    },
    async addPrSuggestions(pr, files, summary): Promise<void> {
      suggestionCalls.push({ pr, files, summary });
    },
    async postCheckRun(pr, conclusion, title, summary): Promise<void> {
      checkRunCalls.push({ pr, conclusion, title, summary });
    },
  };
}
