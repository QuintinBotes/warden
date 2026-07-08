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
import { WardenError } from '@warden/core';
import { requestJson, requestJsonOrNull, requestVoid, type FetchImpl } from './vcs-http.js';

const ERROR_CODE = 'VCS_AZURE_DEVOPS_REQUEST_FAILED';
const DEFAULT_BASE_URL = 'https://dev.azure.com';
const DEFAULT_API_VERSION = '7.1';
const ZERO_OBJECT_ID = '0000000000000000000000000000000000000000';

export interface AzureDevOpsVcsProviderOptions {
  /** An Azure DevOps PAT (`AZURE_DEVOPS_TOKEN`). Sent as HTTP Basic (`:<token>`). */
  token: string;
  /** Defaults to `https://dev.azure.com`; override for Azure DevOps Server. */
  baseUrl?: string;
  /** REST api-version pin. Defaults to `7.1`. */
  apiVersion?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchImpl;
}

interface AzurePr {
  pullRequestId: number;
  title: string;
  isDraft?: boolean;
  sourceRefName: string;
  targetRefName: string;
  lastMergeSourceCommit?: { commitId?: string };
  lastMergeTargetCommit?: { commitId?: string };
  createdBy?: { uniqueName?: string; displayName?: string };
  repository?: { webUrl?: string };
}

interface AzureChangeEntry {
  changeType?: string;
  item?: { path?: string };
}

function stripRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

function mapState(state: VcsCheckStatus['state']): string {
  switch (state) {
    case 'success':
      return 'succeeded';
    case 'failure':
      return 'failed';
    case 'pending':
      return 'pending';
    case 'neutral':
      return 'notApplicable';
  }
}

function mapChangeType(changeType: string | undefined): DiffFile['status'] {
  const kind = (changeType ?? '').toLowerCase();
  if (kind.includes('delete')) return 'deleted';
  if (kind.includes('rename')) return 'renamed';
  if (kind.includes('add')) return 'added';
  return 'modified';
}

/**
 * `AzureDevOpsVcsProvider` — Azure Repos pull-requests / thread comments / commit-status
 * adapter, built on an injected `fetch`. A repo is addressed by `organization/project/repo`
 * (`owner`/`project`/`repo`). `openDraftPr` looks up an active PR by source ref before creating.
 */
export class AzureDevOpsVcsProvider implements VcsProvider {
  readonly host: VcsHost = 'azure-devops';
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: FetchImpl;

  constructor(opts: AzureDevOpsVcsProviderOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchImpl);
  }

  private headers(): Record<string, string> {
    const basic = Buffer.from(`:${this.token}`, 'utf8').toString('base64');
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private project(repo: VcsRepoRef): string {
    if (!repo.project) {
      throw new WardenError(
        'Azure DevOps requires cfg.vcs.project (VcsRepoRef.project) to address a repo',
        ERROR_CODE,
      );
    }
    return repo.project;
  }

  private repoBase(repo: VcsRepoRef): string {
    return `${this.baseUrl}/${repo.owner}/${this.project(repo)}/_apis/git/repositories/${repo.repo}`;
  }

  /** Appends `api-version` as the first or an additional query parameter. */
  private v(url: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}api-version=${this.apiVersion}`;
  }

  async getPullRequest(repo: VcsRepoRef, number: number): Promise<VcsPullRequest> {
    const pr = await requestJson<AzurePr>(
      this.fetchImpl,
      {
        method: 'GET',
        url: this.v(`${this.repoBase(repo)}/pullrequests/${number}`),
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    const webUrl = pr.repository?.webUrl
      ? `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`
      : '';
    return {
      number: pr.pullRequestId,
      title: pr.title,
      url: webUrl,
      headSha: pr.lastMergeSourceCommit?.commitId ?? '',
      headRef: stripRef(pr.sourceRefName),
      baseSha: pr.lastMergeTargetCommit?.commitId ?? '',
      baseRef: stripRef(pr.targetRefName),
      author: pr.createdBy?.uniqueName ?? pr.createdBy?.displayName,
      draft: pr.isDraft ?? false,
    };
  }

  async getDiff(repo: VcsRepoRef, number: number): Promise<DiffFile[]> {
    const iterations = await requestJson<{ value?: { id: number }[] }>(
      this.fetchImpl,
      {
        method: 'GET',
        url: this.v(`${this.repoBase(repo)}/pullRequests/${number}/iterations`),
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    const list = iterations.value ?? [];
    if (list.length === 0) return [];
    const latest = list[list.length - 1]!.id;

    const changes = await requestJson<{ changeEntries?: AzureChangeEntry[] }>(
      this.fetchImpl,
      {
        method: 'GET',
        url: this.v(`${this.repoBase(repo)}/pullRequests/${number}/iterations/${latest}/changes`),
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    return (changes.changeEntries ?? [])
      .filter((entry) => entry.item?.path)
      .map((entry) => ({
        path: (entry.item!.path as string).replace(/^\//, ''),
        status: mapChangeType(entry.changeType),
      }));
  }

  async postComment(repo: VcsRepoRef, prNumber: number, body: string): Promise<void> {
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: this.v(`${this.repoBase(repo)}/pullRequests/${prNumber}/threads`),
        headers: this.headers(),
        body: JSON.stringify({
          comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
          status: 1,
        }),
      },
      ERROR_CODE,
    );
  }

  async postStatus(repo: VcsRepoRef, headSha: string, status: VcsCheckStatus): Promise<void> {
    await requestVoid(
      this.fetchImpl,
      {
        method: 'POST',
        url: this.v(`${this.repoBase(repo)}/commits/${headSha}/statuses`),
        headers: this.headers(),
        body: JSON.stringify({
          state: mapState(status.state),
          description: status.summary,
          ...(status.detailsUrl ? { targetUrl: status.detailsUrl } : {}),
          context: { name: status.context, genre: 'warden' },
        }),
      },
      ERROR_CODE,
    );
  }

  private async branchObjectId(repo: VcsRepoRef, branch: string): Promise<string | null> {
    const refs = await requestJson<{ value?: { name: string; objectId: string }[] }>(
      this.fetchImpl,
      {
        method: 'GET',
        url: this.v(`${this.repoBase(repo)}/refs?filter=heads/${encodeURIComponent(branch)}`),
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    const match = (refs.value ?? []).find((r) => r.name === `refs/heads/${branch}`);
    return match?.objectId ?? null;
  }

  async openDraftPr(request: VcsDraftPrRequest): Promise<VcsDraftPrResult> {
    const repo = request.repo;
    const base = this.repoBase(repo);
    const branch = request.branch;

    const repoInfo = await requestJson<{ defaultBranch?: string; webUrl?: string }>(
      this.fetchImpl,
      { method: 'GET', url: this.v(base), headers: this.headers() },
      ERROR_CODE,
    );
    const baseBranch = request.baseBranch ?? stripRef(repoInfo.defaultBranch ?? 'refs/heads/main');
    const baseObjectId = await this.branchObjectId(repo, baseBranch);

    // Ensure the source branch exists, pointing it at the base tip when missing.
    let branchTip = await this.branchObjectId(repo, branch);
    if (branchTip === null) {
      await requestVoid(
        this.fetchImpl,
        {
          method: 'POST',
          url: this.v(`${base}/refs`),
          headers: this.headers(),
          body: JSON.stringify([
            {
              name: `refs/heads/${branch}`,
              oldObjectId: ZERO_OBJECT_ID,
              newObjectId: baseObjectId,
            },
          ]),
        },
        ERROR_CODE,
      );
      branchTip = baseObjectId;
    }

    // Push all file changes as one commit; per-file changeType by current existence.
    const changes: {
      changeType: string;
      item: { path: string };
      newContent?: { content: string; contentType: string };
    }[] = [];
    for (const file of request.files) {
      if (file.content === null) {
        changes.push({ changeType: 'delete', item: { path: file.path } });
        continue;
      }
      const exists = await requestJsonOrNull<unknown>(
        this.fetchImpl,
        {
          method: 'GET',
          url: this.v(
            `${base}/items?path=${encodeURIComponent(file.path)}&versionDescriptor.versionType=branch&versionDescriptor.version=${encodeURIComponent(branch)}`,
          ),
          headers: this.headers(),
        },
        ERROR_CODE,
      );
      changes.push({
        changeType: exists === null ? 'add' : 'edit',
        item: { path: file.path },
        newContent: { content: file.content, contentType: 'rawtext' },
      });
    }
    if (changes.length > 0) {
      await requestVoid(
        this.fetchImpl,
        {
          method: 'POST',
          url: this.v(`${base}/pushes`),
          headers: this.headers(),
          body: JSON.stringify({
            refUpdates: [
              { name: `refs/heads/${branch}`, oldObjectId: branchTip ?? ZERO_OBJECT_ID },
            ],
            commits: [{ comment: request.title, changes }],
          }),
        },
        ERROR_CODE,
      );
    }

    // Find an active PR for this source ref, else create one (idempotent).
    const sourceRef = `refs/heads/${branch}`;
    const open = await requestJson<{ value?: { pullRequestId: number }[] }>(
      this.fetchImpl,
      {
        method: 'GET',
        url: this.v(
          `${base}/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(sourceRef)}&searchCriteria.status=active`,
        ),
        headers: this.headers(),
      },
      ERROR_CODE,
    );
    const webBase = `${this.baseUrl}/${repo.owner}/${this.project(repo)}/_git/${repo.repo}/pullrequest`;
    const found = (open.value ?? [])[0];
    if (found) {
      await requestVoid(
        this.fetchImpl,
        {
          method: 'PATCH',
          url: this.v(`${base}/pullrequests/${found.pullRequestId}`),
          headers: this.headers(),
          body: JSON.stringify({ title: request.title, description: request.body }),
        },
        ERROR_CODE,
      );
      return { url: `${webBase}/${found.pullRequestId}`, number: found.pullRequestId };
    }
    const created = await requestJson<{ pullRequestId: number }>(
      this.fetchImpl,
      {
        method: 'POST',
        url: this.v(`${base}/pullrequests`),
        headers: this.headers(),
        body: JSON.stringify({
          sourceRefName: sourceRef,
          targetRefName: `refs/heads/${baseBranch}`,
          title: request.title,
          description: request.body,
          isDraft: true,
        }),
      },
      ERROR_CODE,
    );
    return { url: `${webBase}/${created.pullRequestId}`, number: created.pullRequestId };
  }
}
