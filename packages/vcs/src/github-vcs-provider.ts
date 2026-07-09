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

const ERROR_CODE = 'VCS_GITHUB_REQUEST_FAILED';
const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_MAX_FILES = 300;
const PER_PAGE = 100;

export interface GitHubVcsProviderOptions {
  /** A GitHub token (`GITHUB_TOKEN` in Actions, or a PAT). */
  token: string;
  /** Defaults to `https://api.github.com`; override for GitHub Enterprise Server. */
  baseUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchImpl;
  /** Caps the number of diff files fetched (bounded pagination). */
  maxFiles?: number;
}

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  draft?: boolean;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  user?: { login: string };
}

interface GitHubFile {
  filename: string;
  status: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

function mapStatus(status: string): DiffFile['status'] {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * `GitHubVcsProvider` — the GitHub REST v3 adapter, at parity with today's
 * `createFetchOctokit`, built entirely on an injected `fetch`. Reimplements PR fetch, diff,
 * PR comment, Check Run status, and idempotent draft-PR behind the host-agnostic `VcsProvider`.
 */
export class GitHubVcsProvider implements VcsProvider {
  readonly host: VcsHost = 'github';
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly maxFiles: number;

  constructor(opts: GitHubVcsProviderOptions) {
    this.token = opts.token;
    this.baseUrl = stripTrailingSlashes(opts.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);
    this.maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private repoPath(repo: VcsRepoRef): string {
    return `${this.baseUrl}/repos/${repo.owner}/${repo.repo}`;
  }

  async getPullRequest(repo: VcsRepoRef, number: number): Promise<VcsPullRequest> {
    const pull = await requestJson<GitHubPull>(
      this.fetchImpl,
      { method: 'GET', url: `${this.repoPath(repo)}/pulls/${number}`, headers: this.headers() },
      ERROR_CODE,
    );
    return {
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      headSha: pull.head.sha,
      headRef: pull.head.ref,
      baseSha: pull.base.sha,
      baseRef: pull.base.ref,
      author: pull.user?.login,
      draft: pull.draft ?? false,
    };
  }

  async getDiff(repo: VcsRepoRef, number: number): Promise<DiffFile[]> {
    const out: DiffFile[] = [];
    for (let page = 1; out.length < this.maxFiles; page++) {
      const url = `${this.repoPath(repo)}/pulls/${number}/files?per_page=${PER_PAGE}&page=${page}`;
      const files = await requestJson<GitHubFile[]>(
        this.fetchImpl,
        { method: 'GET', url, headers: this.headers() },
        ERROR_CODE,
      );
      for (const file of files) {
        out.push({
          path: file.filename,
          status: mapStatus(file.status),
          ...(file.additions !== undefined ? { additions: file.additions } : {}),
          ...(file.deletions !== undefined ? { deletions: file.deletions } : {}),
          ...(file.patch !== undefined ? { patch: file.patch } : {}),
        });
      }
      if (files.length < PER_PAGE) break;
    }
    return out.slice(0, this.maxFiles);
  }

  async postComment(repo: VcsRepoRef, prNumber: number, body: string): Promise<void> {
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${this.repoPath(repo)}/issues/${prNumber}/comments`,
        headers: this.headers(),
        body: JSON.stringify({ body }),
      },
      ERROR_CODE,
    );
  }

  async postStatus(repo: VcsRepoRef, headSha: string, status: VcsCheckStatus): Promise<void> {
    const completed = status.state !== 'pending';
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${this.repoPath(repo)}/check-runs`,
        headers: this.headers(),
        body: JSON.stringify({
          name: status.context,
          head_sha: headSha,
          status: completed ? 'completed' : 'in_progress',
          ...(completed ? { conclusion: status.state } : {}),
          ...(status.detailsUrl ? { details_url: status.detailsUrl } : {}),
          output: { title: status.title, summary: status.summary },
        }),
      },
      ERROR_CODE,
    );
  }

  private async getJson<T>(url: string): Promise<T> {
    return requestJson<T>(
      this.fetchImpl,
      { method: 'GET', url, headers: this.headers() },
      ERROR_CODE,
    );
  }

  /** GETs `url`, returning `null` on a 404 (a missing branch/file is normal control flow). */
  private async getOrNull<T>(url: string): Promise<T | null> {
    return requestJsonOrNull<T>(
      this.fetchImpl,
      { method: 'GET', url, headers: this.headers() },
      ERROR_CODE,
    );
  }

  async openDraftPr(request: VcsDraftPrRequest): Promise<VcsDraftPrResult> {
    const base = this.repoPath(request.repo);
    const owner = request.repo.owner;
    const branch = request.branch;

    const baseBranch =
      request.baseBranch ??
      (await this.getJson<{ default_branch?: string }>(base)).default_branch ??
      'main';

    // Ensure the sync branch exists, creating it off the base branch's tip.
    const existingRef = await this.getOrNull<{ object?: { sha?: string } }>(
      `${base}/git/ref/heads/${branch}`,
    );
    if (existingRef === null) {
      const baseRef = await this.getJson<{ object: { sha: string } }>(
        `${base}/git/ref/heads/${baseBranch}`,
      );
      await requestVoid(
        this.fetchImpl,
        {
          method: 'POST',
          url: `${base}/git/refs`,
          headers: this.headers(),
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
        },
        ERROR_CODE,
      );
    }

    // Commit each file to the branch over the contents API (base64; `null` = delete).
    for (const file of request.files) {
      const existing = await this.getOrNull<{ sha?: string }>(
        `${base}/contents/${file.path}?ref=${branch}`,
      );
      const sha = existing?.sha;
      if (file.content === null) {
        if (!sha) continue; // nothing to delete
        await requestVoid(
          this.fetchImpl,
          {
            method: 'DELETE',
            url: `${base}/contents/${file.path}`,
            headers: this.headers(),
            body: JSON.stringify({ message: `warden: remove ${file.path}`, branch, sha }),
          },
          ERROR_CODE,
        );
      } else {
        await requestVoid(
          this.fetchImpl,
          {
            method: 'PUT',
            url: `${base}/contents/${file.path}`,
            headers: this.headers(),
            body: JSON.stringify({
              message: `warden: ${sha ? 'update' : 'add'} ${file.path}`,
              content: Buffer.from(file.content, 'utf8').toString('base64'),
              branch,
              ...(sha ? { sha } : {}),
            }),
          },
          ERROR_CODE,
        );
      }
    }

    // Open a draft PR, or update the one already open for this branch (idempotent).
    const open = await this.getJson<{ number: number; html_url: string }[]>(
      `${base}/pulls?head=${owner}:${branch}&state=open`,
    );
    if (open.length > 0) {
      const updated = await requestJson<{ number: number; html_url: string }>(
        this.fetchImpl,
        {
          method: 'PATCH',
          url: `${base}/pulls/${open[0]!.number}`,
          headers: this.headers(),
          body: JSON.stringify({ title: request.title, body: request.body }),
        },
        ERROR_CODE,
      );
      return { url: updated.html_url, number: updated.number };
    }
    const created = await requestJson<{ number: number; html_url: string }>(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${base}/pulls`,
        headers: this.headers(),
        body: JSON.stringify({
          title: request.title,
          head: branch,
          base: baseBranch,
          body: request.body,
          draft: true,
        }),
      },
      ERROR_CODE,
    );
    return { url: created.html_url, number: created.number };
  }
}
