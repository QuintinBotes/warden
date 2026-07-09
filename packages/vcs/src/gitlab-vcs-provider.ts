import type {
  DiffFile,
  VcsCheckStatus,
  VcsDraftPrRequest,
  VcsDraftPrResult,
  VcsHost,
  VcsProvider,
  VcsPullRequest,
  VcsRepoRef,
} from '@warden/core';
import { stripTrailingSlashes } from '@warden/core';
import { requestJson, requestJsonOrNull, requestVoid, type FetchImpl } from './vcs-http.js';

const ERROR_CODE = 'VCS_GITLAB_REQUEST_FAILED';
const DEFAULT_BASE_URL = 'https://gitlab.com/api/v4';
const DEFAULT_MAX_FILES = 300;
const PER_PAGE = 100;

export interface GitLabVcsProviderOptions {
  /** A GitLab personal access token / CI job token (`GITLAB_TOKEN`). Sent as `PRIVATE-TOKEN`. */
  token: string;
  /** Defaults to `https://gitlab.com/api/v4`; override for GitLab self-managed. */
  baseUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchImpl;
  /** Caps the number of diff files fetched (bounded pagination). */
  maxFiles?: number;
}

interface GitLabMr {
  iid: number;
  title: string;
  web_url: string;
  sha?: string;
  source_branch: string;
  target_branch: string;
  work_in_progress?: boolean;
  draft?: boolean;
  author?: { username: string };
  diff_refs?: { base_sha?: string; head_sha?: string };
}

interface GitLabDiff {
  old_path: string;
  new_path: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  diff?: string;
}

function mapState(state: VcsCheckStatus['state']): string {
  switch (state) {
    case 'success':
      return 'success';
    case 'failure':
      return 'failed';
    case 'pending':
      return 'pending';
    case 'neutral':
      return 'success';
  }
}

function mapDiffStatus(diff: GitLabDiff): DiffFile['status'] {
  if (diff.new_file) return 'added';
  if (diff.deleted_file) return 'deleted';
  if (diff.renamed_file) return 'renamed';
  return 'modified';
}

/**
 * `GitLabVcsProvider` — GitLab Merge Requests / Notes / Commit Statuses adapter, built on an
 * injected `fetch`. A project is addressed by its URL-encoded `owner/repo` path. `openDraftPr`
 * finds an existing open MR by source branch before creating a new one.
 */
export class GitLabVcsProvider implements VcsProvider {
  readonly host: VcsHost = 'gitlab';
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly maxFiles: number;

  constructor(opts: GitLabVcsProviderOptions) {
    this.token = opts.token;
    this.baseUrl = stripTrailingSlashes(opts.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);
    this.maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  }

  private headers(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private projectPath(repo: VcsRepoRef): string {
    const id = encodeURIComponent(`${repo.owner}/${repo.repo}`);
    return `${this.baseUrl}/projects/${id}`;
  }

  async getPullRequest(repo: VcsRepoRef, number: number): Promise<VcsPullRequest> {
    const mr = await requestJson<GitLabMr>(
      this.fetchImpl,
      {
        method: 'GET',
        url: `${this.projectPath(repo)}/merge_requests/${number}`,
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    return {
      number: mr.iid,
      title: mr.title,
      url: mr.web_url,
      headSha: mr.diff_refs?.head_sha ?? mr.sha ?? '',
      headRef: mr.source_branch,
      baseSha: mr.diff_refs?.base_sha ?? '',
      baseRef: mr.target_branch,
      author: mr.author?.username,
      draft: mr.draft ?? mr.work_in_progress ?? false,
    };
  }

  async getDiff(repo: VcsRepoRef, number: number): Promise<DiffFile[]> {
    const out: DiffFile[] = [];
    for (let page = 1; out.length < this.maxFiles; page++) {
      const url = `${this.projectPath(repo)}/merge_requests/${number}/diffs?per_page=${PER_PAGE}&page=${page}`;
      const diffs = await requestJson<GitLabDiff[]>(
        this.fetchImpl,
        { method: 'GET', url, headers: this.headers() },
        ERROR_CODE,
      );
      for (const diff of diffs) {
        out.push({
          path: diff.deleted_file ? diff.old_path : diff.new_path,
          status: mapDiffStatus(diff),
          ...(diff.diff !== undefined ? { patch: diff.diff } : {}),
        });
      }
      if (diffs.length < PER_PAGE) break;
    }
    return out.slice(0, this.maxFiles);
  }

  async postComment(repo: VcsRepoRef, prNumber: number, body: string): Promise<void> {
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${this.projectPath(repo)}/merge_requests/${prNumber}/notes`,
        headers: this.headers(),
        body: JSON.stringify({ body }),
      },
      ERROR_CODE,
    );
  }

  async postStatus(repo: VcsRepoRef, headSha: string, status: VcsCheckStatus): Promise<void> {
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${this.projectPath(repo)}/statuses/${headSha}`,
        headers: this.headers(),
        body: JSON.stringify({
          state: mapState(status.state),
          name: status.context,
          description: status.title,
          ...(status.detailsUrl ? { target_url: status.detailsUrl } : {}),
        }),
      },
      ERROR_CODE,
    );
  }

  async openDraftPr(request: VcsDraftPrRequest): Promise<VcsDraftPrResult> {
    const project = this.projectPath(request.repo);
    const branch = request.branch;

    const baseBranch =
      request.baseBranch ??
      (await requestJson<{ default_branch?: string }>(
        this.fetchImpl,
        { method: 'GET', url: project, headers: this.headers() },
        ERROR_CODE,
      ).then((p) => p.default_branch)) ??
      'main';

    // Ensure the source branch exists, creating it off the base branch when missing.
    const existingBranch = await requestJsonOrNull<unknown>(
      this.fetchImpl,
      {
        method: 'GET',
        url: `${project}/repository/branches/${encodeURIComponent(branch)}`,
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    if (existingBranch === null) {
      await requestVoid(
        this.fetchImpl,
        {
          method: 'POST',
          url: `${project}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(baseBranch)}`,
          headers: this.headers(),
        },
        ERROR_CODE,
      );
    }

    // Commit all files in a single commit; per-file action chosen by current existence.
    const actions: { action: string; file_path: string; content?: string }[] = [];
    for (const file of request.files) {
      if (file.content === null) {
        actions.push({ action: 'delete', file_path: file.path });
        continue;
      }
      const exists = await requestJsonOrNull<unknown>(
        this.fetchImpl,
        {
          method: 'GET',
          url: `${project}/repository/files/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(branch)}`,
          headers: this.headers(),
        },
        ERROR_CODE,
      );
      actions.push({
        action: exists === null ? 'create' : 'update',
        file_path: file.path,
        content: file.content,
      });
    }
    if (actions.length > 0) {
      await requestVoid(
        this.fetchImpl,
        {
          method: 'POST',
          url: `${project}/repository/commits`,
          headers: this.headers(),
          body: JSON.stringify({
            branch,
            commit_message: request.title,
            actions,
          }),
        },
        ERROR_CODE,
      );
    }

    // Find an existing open MR for this source branch, else create one (idempotent).
    const title = /^draft:/i.test(request.title) ? request.title : `Draft: ${request.title}`;
    const open = await requestJson<{ iid: number; web_url: string }[]>(
      this.fetchImpl,
      {
        method: 'GET',
        url: `${project}/merge_requests?source_branch=${encodeURIComponent(branch)}&state=opened`,
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    if (open.length > 0) {
      const updated = await requestJson<{ iid: number; web_url: string }>(
        this.fetchImpl,
        {
          method: 'PUT',
          url: `${project}/merge_requests/${open[0]!.iid}`,
          headers: this.headers(),
          body: JSON.stringify({ title, description: request.body }),
        },
        ERROR_CODE,
      );
      return { url: updated.web_url, number: updated.iid };
    }
    const created = await requestJson<{ iid: number; web_url: string }>(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${project}/merge_requests`,
        headers: this.headers(),
        body: JSON.stringify({
          source_branch: branch,
          target_branch: baseBranch,
          title,
          description: request.body,
        }),
      },
      ERROR_CODE,
    );
    return { url: created.web_url, number: created.iid };
  }
}
