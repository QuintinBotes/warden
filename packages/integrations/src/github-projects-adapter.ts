import { type CoverageStatus, type IntegrationAdapter, type Requirement } from '@warden/core';
import { defaultFetch, requestJson, type FetchLike } from './fetch-like.js';
import { mapLabelsToRequirementType } from './status-mapping.js';

export interface GithubProjectsAdapterOptions {
  /** A GitHub personal access token, sent as `Authorization: token <token>`. */
  token: string;
  /** Repository owner (user or org). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Overrides the REST API base — defaults to the public GitHub API. */
  apiUrl?: string;
}

interface GithubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  state_reason: string | null;
  labels: { name: string }[];
}

/**
 * Syncs Warden `Requirement`s against GitHub issues (the backing store of GitHub Projects)
 * via the GitHub REST API. Each open/closed issue in the repo is treated as one requirement.
 */
export class GithubProjectsAdapter implements IntegrationAdapter {
  readonly name = 'github-projects' as const;

  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiUrl: string;

  constructor(opts: GithubProjectsAdapterOptions) {
    this.token = opts.token;
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
    this.apiUrl = opts.apiUrl ?? 'https://api.github.com';
  }

  async fetchRequirements(): Promise<Requirement[]> {
    const url = `${this.apiUrl}/repos/${this.owner}/${this.repo}/issues?state=all`;
    const issues = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'GET', headers: this.headers() },
      'INTEGRATION_GITHUB_REQUEST_FAILED',
    )) as GithubIssue[];

    return issues.map((issue) => ({
      id: String(issue.number),
      title: issue.title,
      type: mapLabelsToRequirementType(issue.labels.map((label) => label.name)),
      linkedTestIds: [],
      coverageStatus: this.mapCoverageStatus(issue),
    }));
  }

  async pushResult(requirementId: string, status: CoverageStatus): Promise<void> {
    const url = `${this.apiUrl}/repos/${this.owner}/${this.repo}/issues/${requirementId}`;
    await requestJson(
      this.fetchImpl,
      url,
      {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify({ labels: [`warden-coverage:${status.toLowerCase()}`] }),
      },
      'INTEGRATION_GITHUB_REQUEST_FAILED',
    );
  }

  private mapCoverageStatus(issue: GithubIssue): CoverageStatus {
    if (issue.state === 'closed') {
      return issue.state_reason === 'not_planned' ? 'FAILED' : 'PASSED';
    }
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    if (labels.some((label) => label.includes('in-progress') || label.includes('in progress'))) {
      return 'PARTIAL';
    }
    return 'NOT_TESTED';
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `token ${this.token}`,
    };
  }
}
