import { type CoverageStatus, type IntegrationAdapter, type Requirement } from '@warden/core';
import { defaultFetch, requestJson, type FetchLike } from './fetch-like.js';
import { mapLabelsToRequirementType, mapStateNameToCoverageStatus } from './status-mapping.js';

export interface JiraAdapterOptions {
  /** A Jira Cloud API token (or PAT), sent as `Authorization: Bearer <token>`. */
  token: string;
  /** The Jira site base URL, e.g. `https://your-domain.atlassian.net`. */
  baseUrl: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** JQL used to select requirements. Defaults to all issues in the site, newest first. */
  jql?: string;
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    issuetype: { name: string };
    status: { name: string };
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
}

/** Syncs Warden `Requirement`s against Jira issues via the Jira Cloud REST API v3. */
export class JiraAdapter implements IntegrationAdapter {
  readonly name = 'jira' as const;

  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly jql: string;

  constructor(opts: JiraAdapterOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
    this.jql = opts.jql ?? 'order by created DESC';
  }

  async fetchRequirements(): Promise<Requirement[]> {
    const url = `${this.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(this.jql)}`;
    const body = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'GET', headers: this.headers() },
      'INTEGRATION_JIRA_REQUEST_FAILED',
    )) as JiraSearchResponse;

    return body.issues.map((issue) => ({
      id: issue.key,
      title: issue.fields.summary,
      type: mapLabelsToRequirementType([issue.fields.issuetype.name]),
      linkedTestIds: [],
      coverageStatus: mapStateNameToCoverageStatus(issue.fields.status.name),
    }));
  }

  async pushResult(requirementId: string, status: CoverageStatus): Promise<void> {
    const url = `${this.baseUrl}/rest/api/3/issue/${requirementId}/comment`;
    await requestJson(
      this.fetchImpl,
      url,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ body: `Warden coverage: ${status}` }),
      },
      'INTEGRATION_JIRA_REQUEST_FAILED',
    );
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }
}
