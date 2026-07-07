import {
  WardenError,
  type CoverageStatus,
  type IntegrationAdapter,
  type Requirement,
} from '@warden/core';
import { defaultFetch, requestJson, type FetchLike } from './fetch-like.js';
import { mapLabelsToRequirementType, mapStateNameToCoverageStatus } from './status-mapping.js';

export interface LinearAdapterOptions {
  /** A Linear personal API key or OAuth access token. Sent verbatim as `Authorization`. */
  token: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Restricts `fetchRequirements` to a single Linear team. Omit to fetch across all teams. */
  teamId?: string;
  /** Overrides the GraphQL endpoint — defaults to the public Linear API. */
  apiUrl?: string;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  state: { name: string };
  labels: { nodes: { name: string }[] };
}

interface LinearIssuesResponse {
  data?: { issues: { nodes: LinearIssueNode[] } };
  errors?: { message: string }[];
}

interface LinearMutationResponse {
  data?: unknown;
  errors?: { message: string }[];
}

const ISSUES_QUERY = `
  query WardenIssues($teamId: String) {
    issues(filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id
        identifier
        title
        state { name }
        labels { nodes { name } }
      }
    }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation WardenCommentCreate($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
    }
  }
`;

/** Syncs Warden `Requirement`s against Linear issues via the Linear GraphQL API. */
export class LinearAdapter implements IntegrationAdapter {
  readonly name = 'linear' as const;

  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly teamId?: string;
  private readonly apiUrl: string;

  constructor(opts: LinearAdapterOptions) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
    this.teamId = opts.teamId;
    this.apiUrl = opts.apiUrl ?? 'https://api.linear.app/graphql';
  }

  async fetchRequirements(): Promise<Requirement[]> {
    const body = await this.graphql<LinearIssuesResponse>(ISSUES_QUERY, {
      teamId: this.teamId,
    });

    const nodes = body.data?.issues.nodes ?? [];
    return nodes.map((node) => ({
      id: node.identifier,
      title: node.title,
      type: mapLabelsToRequirementType(node.labels.nodes.map((label) => label.name)),
      linkedTestIds: [],
      coverageStatus: mapStateNameToCoverageStatus(node.state.name),
    }));
  }

  async pushResult(requirementId: string, status: CoverageStatus): Promise<void> {
    await this.graphql<LinearMutationResponse>(COMMENT_CREATE_MUTATION, {
      issueId: requirementId,
      body: `Warden coverage: ${status}`,
    });
  }

  private async graphql<T extends { errors?: { message: string }[] }>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const result = (await requestJson(
      this.fetchImpl,
      this.apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.token },
        body: JSON.stringify({ query, variables }),
      },
      'INTEGRATION_LINEAR_REQUEST_FAILED',
    )) as T;

    if (result.errors && result.errors.length > 0) {
      throw new WardenError(
        `Linear GraphQL error: ${result.errors.map((e) => e.message).join('; ')}`,
        'INTEGRATION_LINEAR_GRAPHQL_ERROR',
      );
    }

    return result;
  }
}
