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
import { requestJson, requestJsonOrNull, requestVoid, type FetchImpl } from './vcs-http.js';

const ERROR_CODE = 'VCS_BITBUCKET_REQUEST_FAILED';
const DEFAULT_BASE_URL = 'https://api.bitbucket.org/2.0';
const DEFAULT_MAX_FILES = 300;
const PAGE_LEN = 100;

export interface BitbucketVcsProviderOptions {
  /** A Bitbucket access token / app password (`BITBUCKET_TOKEN`). Sent as `Bearer`. */
  token: string;
  /** Defaults to `https://api.bitbucket.org/2.0`; override for Bitbucket Server. */
  baseUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchImpl;
  /** Caps the number of diff files fetched (bounded pagination). */
  maxFiles?: number;
}

interface BitbucketPr {
  id: number;
  title: string;
  draft?: boolean;
  links?: { html?: { href?: string } };
  source?: { commit?: { hash?: string }; branch?: { name?: string } };
  destination?: { commit?: { hash?: string }; branch?: { name?: string } };
  author?: { nickname?: string; display_name?: string };
}

interface BitbucketDiffStat {
  status?: string;
  lines_added?: number;
  lines_removed?: number;
  old?: { path?: string } | null;
  new?: { path?: string } | null;
}

interface BitbucketPage<T> {
  values?: T[];
}

function mapState(state: VcsCheckStatus['state']): string {
  switch (state) {
    case 'success':
      return 'SUCCESSFUL';
    case 'failure':
      return 'FAILED';
    case 'pending':
      return 'INPROGRESS';
    case 'neutral':
      return 'SUCCESSFUL';
  }
}

function mapDiffStatus(status: string | undefined): DiffFile['status'] {
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
 * `BitbucketVcsProvider` — Bitbucket Cloud pull-requests / comments / build-status adapter,
 * built on an injected `fetch`. A repo is addressed by `workspace/repo_slug`. `openDraftPr`
 * looks up an existing open PR by source branch before creating one.
 */
export class BitbucketVcsProvider implements VcsProvider {
  readonly host: VcsHost = 'bitbucket';
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;
  private readonly maxFiles: number;

  constructor(opts: BitbucketVcsProviderOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);
    this.maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private repoPath(repo: VcsRepoRef): string {
    return `${this.baseUrl}/repositories/${repo.owner}/${repo.repo}`;
  }

  async getPullRequest(repo: VcsRepoRef, number: number): Promise<VcsPullRequest> {
    const pr = await requestJson<BitbucketPr>(
      this.fetchImpl,
      {
        method: 'GET',
        url: `${this.repoPath(repo)}/pullrequests/${number}`,
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    return {
      number: pr.id,
      title: pr.title,
      url: pr.links?.html?.href ?? '',
      headSha: pr.source?.commit?.hash ?? '',
      headRef: pr.source?.branch?.name ?? '',
      baseSha: pr.destination?.commit?.hash ?? '',
      baseRef: pr.destination?.branch?.name ?? '',
      author: pr.author?.nickname ?? pr.author?.display_name,
      draft: pr.draft ?? false,
    };
  }

  async getDiff(repo: VcsRepoRef, number: number): Promise<DiffFile[]> {
    const out: DiffFile[] = [];
    for (let page = 1; out.length < this.maxFiles; page++) {
      const url = `${this.repoPath(repo)}/pullrequests/${number}/diffstat?pagelen=${PAGE_LEN}&page=${page}`;
      const body = await requestJson<BitbucketPage<BitbucketDiffStat>>(
        this.fetchImpl,
        { method: 'GET', url, headers: this.headers() },
        ERROR_CODE,
      );
      const values = body.values ?? [];
      for (const entry of values) {
        out.push({
          path: entry.new?.path ?? entry.old?.path ?? '',
          status: mapDiffStatus(entry.status),
          ...(entry.lines_added !== undefined ? { additions: entry.lines_added } : {}),
          ...(entry.lines_removed !== undefined ? { deletions: entry.lines_removed } : {}),
        });
      }
      if (values.length < PAGE_LEN) break;
    }
    return out.slice(0, this.maxFiles);
  }

  async postComment(repo: VcsRepoRef, prNumber: number, body: string): Promise<void> {
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${this.repoPath(repo)}/pullrequests/${prNumber}/comments`,
        headers: this.headers(),
        body: JSON.stringify({ content: { raw: body } }),
      },
      ERROR_CODE,
    );
  }

  async postStatus(repo: VcsRepoRef, headSha: string, status: VcsCheckStatus): Promise<void> {
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${this.repoPath(repo)}/commit/${headSha}/statuses/build`,
        headers: this.headers(),
        body: JSON.stringify({
          key: status.context,
          state: mapState(status.state),
          name: status.title,
          description: status.summary,
          ...(status.detailsUrl ? { url: status.detailsUrl } : {}),
        }),
      },
      ERROR_CODE,
    );
  }

  async openDraftPr(request: VcsDraftPrRequest): Promise<VcsDraftPrResult> {
    const base = this.repoPath(request.repo);
    const branch = request.branch;

    const baseBranch =
      request.baseBranch ??
      (await requestJson<{ mainbranch?: { name?: string } }>(
        this.fetchImpl,
        { method: 'GET', url: base, headers: this.headers() },
        ERROR_CODE,
      ).then((r) => r.mainbranch?.name)) ??
      'main';

    // Ensure the source branch exists, creating it off the base branch's tip when missing.
    const existing = await requestJsonOrNull<{ target?: { hash?: string } }>(
      this.fetchImpl,
      {
        method: 'GET',
        url: `${base}/refs/branches/${encodeURIComponent(branch)}`,
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    if (existing === null) {
      const baseRef = await requestJson<{ target?: { hash?: string } }>(
        this.fetchImpl,
        {
          method: 'GET',
          url: `${base}/refs/branches/${encodeURIComponent(baseBranch)}`,
          headers: this.headers(),
        },
        ERROR_CODE,
      );
      await requestVoid(
        this.fetchImpl,
        {
          method: 'POST',
          url: `${base}/refs/branches`,
          headers: this.headers(),
          body: JSON.stringify({ name: branch, target: { hash: baseRef.target?.hash } }),
        },
        ERROR_CODE,
      );
    }

    // Commit all files with one `src` write (form-encoded: `<path>=<content>`; `files=<path>`
    // deletes). A single request keeps it one atomic commit on the source branch.
    const form = new URLSearchParams();
    form.set('branch', branch);
    form.set('message', request.title);
    for (const file of request.files) {
      if (file.content === null) form.append('files', file.path);
      else form.set(file.path, file.content);
    }
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${base}/src`,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
      ERROR_CODE,
    );

    // Find an existing open PR for this source branch, else create one (idempotent).
    const query = encodeURIComponent(`source.branch.name="${branch}"`);
    const open = await requestJson<
      BitbucketPage<{ id: number; links?: { html?: { href?: string } } }>
    >(
      this.fetchImpl,
      {
        method: 'GET',
        url: `${base}/pullrequests?q=${query}&state=OPEN`,
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    const found = (open.values ?? [])[0];
    if (found) {
      const updated = await requestJson<{ id: number; links?: { html?: { href?: string } } }>(
        this.fetchImpl,
        {
          method: 'PUT',
          url: `${base}/pullrequests/${found.id}`,
          headers: this.headers(),
          body: JSON.stringify({ title: request.title, description: request.body }),
        },
        ERROR_CODE,
      );
      return { url: updated.links?.html?.href ?? '', number: updated.id };
    }
    const created = await requestJson<{ id: number; links?: { html?: { href?: string } } }>(
      this.fetchImpl,
      {
        method: 'POST',
        url: `${base}/pullrequests`,
        headers: this.headers(),
        body: JSON.stringify({
          title: request.title,
          source: { branch: { name: branch } },
          destination: { branch: { name: baseBranch } },
          description: request.body,
          draft: true,
        }),
      },
      ERROR_CODE,
    );
    return { url: created.links?.html?.href ?? '', number: created.id };
  }
}
