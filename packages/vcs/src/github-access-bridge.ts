import type {
  DraftPrResult,
  GitHubAccess,
  PrRef,
  RepoTarget,
  VcsHost,
  VcsProvider,
  VcsRepoRef,
} from '@warden/core';

/** Hosts with a native inline-suggestion syntax; others fall back to a fenced-diff comment. */
const SUGGESTION_NATIVE_HOSTS: ReadonlySet<VcsHost> = new Set(['github', 'gitlab']);

export interface GitHubAccessBridgeOptions {
  /** Azure DevOps project — needed to build a `VcsRepoRef` for that host. */
  project?: string;
  /** Overrides how the proposed files are rendered into the suggestion comment body. */
  renderSuggestion?: (files: { path: string; content: string }[], host: VcsHost) => string;
}

function repoRefFrom(repo: string, host: VcsHost, project?: string): VcsRepoRef {
  const slash = repo.indexOf('/');
  const owner = slash === -1 ? repo : repo.slice(0, slash);
  const name = slash === -1 ? '' : repo.slice(slash + 1);
  return { host, owner, repo: name, ...(project ? { project } : {}) };
}

/** Renders the default suggestion-comment body, native inline vs. fenced-diff fallback. */
function defaultRenderSuggestion(
  files: { path: string; content: string }[],
  host: VcsHost,
  summary: string,
): string {
  const native = SUGGESTION_NATIVE_HOSTS.has(host);
  const fence = native ? 'suggestion' : 'diff';
  const note = native
    ? '_Rendered as inline suggestions._'
    : '> Rendered as a fenced diff — this host has no inline-suggestion API; apply the change manually.';
  const sections = files
    .map((file) => `#### \`${file.path}\`\n\n\`\`\`${fence}\n${file.content}\n\`\`\``)
    .join('\n\n');
  return `${summary}\n\n${note}\n\n### Proposed changes\n\n${sections}`;
}

/**
 * Bridges any {@link VcsProvider} onto the existing {@link GitHubAccess} seam, so
 * `@warden/coverage-sync`'s `publish()` (and the whole coverage-sync pipeline) runs
 * unmodified against a GitLab, Bitbucket, or Azure DevOps provider:
 *
 * - `openOrUpdateDraftPr` → `provider.openDraftPr` (idempotent per-host).
 * - `postCheckRun` → `provider.postStatus` (`context: 'warden-coverage-sync'`).
 * - `addPrSuggestions` → `provider.postComment`, rendering native inline suggestions on
 *   GitHub/GitLab and a labeled fenced-diff comment on Bitbucket/Azure DevOps — never a
 *   silent degradation; the comment body always states which mode was used.
 */
export function createGitHubAccessFromVcsProvider(
  provider: VcsProvider,
  opts: GitHubAccessBridgeOptions = {},
): GitHubAccess {
  const host = provider.host;

  return {
    async openOrUpdateDraftPr(
      repo: RepoTarget,
      branch: string,
      files: { path: string; content: string | null }[],
      title: string,
      body: string,
    ): Promise<DraftPrResult> {
      const result = await provider.openDraftPr({
        repo: repoRefFrom(repo, host, opts.project),
        branch,
        title,
        body,
        files,
      });
      return { url: result.url, number: result.number };
    },

    async addPrSuggestions(
      pr: PrRef,
      files: { path: string; content: string }[],
      summary: string,
    ): Promise<void> {
      const body = opts.renderSuggestion
        ? opts.renderSuggestion(files, host)
        : defaultRenderSuggestion(files, host, summary);
      const repo: VcsRepoRef = {
        host,
        owner: pr.owner,
        repo: pr.repo,
        ...(opts.project ? { project: opts.project } : {}),
      };
      await provider.postComment(repo, pr.number, body);
    },

    async postCheckRun(
      pr: PrRef,
      conclusion: 'success' | 'neutral' | 'failure',
      title: string,
      summary: string,
    ): Promise<void> {
      const repo: VcsRepoRef = {
        host,
        owner: pr.owner,
        repo: pr.repo,
        ...(opts.project ? { project: opts.project } : {}),
      };
      await provider.postStatus(repo, pr.headSha, {
        context: 'warden-coverage-sync',
        state: conclusion,
        title,
        summary,
      });
    },
  };
}
