import type { DiffFile } from './change-surface';

/**
 * The `VcsProvider` seam — the one contract every SCM-touching Warden surface depends on,
 * never a host SDK directly. `@warden/vcs` ships one adapter per host (GitHub, GitLab,
 * Bitbucket, Azure DevOps); `@warden/core/testing` ships an in-memory fake.
 *
 * These are additive, host-agnostic types: the reporter/gate/coverage-sync surfaces are
 * generalized off GitHub-specific clients onto this interface so the CI-embedded flow —
 * run tests, post a comment, set a status, gate the merge — works identically on all hosts.
 */

/** The four supported hosts. Each has one `VcsProvider` adapter in `@warden/vcs`. */
export type VcsHost = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops';

/**
 * A repository identifier generalized beyond GitHub's owner/repo. `project` is used only by
 * Azure DevOps, where a repo is scoped under `organization/project/repo`; `owner` carries the
 * org for Azure DevOps and GitLab, the workspace for Bitbucket, and the user/org for GitHub.
 */
export interface VcsRepoRef {
  host: VcsHost;
  owner: string;
  repo: string;
  project?: string; // Azure DevOps only
}

export interface VcsPullRequest {
  number: number; // PR / MR / pull request iid, whatever the host calls it
  title: string;
  url: string;
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
  author?: string;
  draft: boolean;
}

export type VcsCheckState = 'success' | 'neutral' | 'failure' | 'pending';

export interface VcsCheckStatus {
  /** A stable identifier for the check ('warden-qa'); reused across re-runs to update, not duplicate. */
  context: string;
  state: VcsCheckState;
  title: string;
  summary: string;
  detailsUrl?: string;
}

export interface VcsFileChange {
  path: string;
  content: string | null; // null = delete
}

export interface VcsDraftPrRequest {
  repo: VcsRepoRef;
  branch: string;
  baseBranch?: string; // defaults to the repo's default branch
  title: string;
  body: string;
  files: VcsFileChange[];
}

export interface VcsDraftPrResult {
  url: string;
  number: number;
}

/**
 * The one seam every SCM-touching Warden surface depends on — never a host SDK directly.
 * `@warden/vcs` ships one implementation per host; `@warden/core/testing` ships a fake.
 */
export interface VcsProvider {
  readonly host: VcsHost;
  getPullRequest(repo: VcsRepoRef, number: number): Promise<VcsPullRequest>;
  getDiff(repo: VcsRepoRef, number: number): Promise<DiffFile[]>;
  postComment(repo: VcsRepoRef, prNumber: number, body: string): Promise<void>;
  /**
   * Creates or updates (by `context`) the status/check for a commit — Check Run, commit
   * status, build status, or PR status, per host.
   */
  postStatus(repo: VcsRepoRef, headSha: string, status: VcsCheckStatus): Promise<void>;
  /**
   * Idempotent: re-invoking for the same `repo`+`branch` updates the existing open PR/MR
   * instead of opening a duplicate.
   */
  openDraftPr(request: VcsDraftPrRequest): Promise<VcsDraftPrResult>;
}
