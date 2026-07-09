import type {
  SpecCatalogEntry,
  TestManagementSync,
  TmsResultPush,
  TmsRunMeta,
  TmsTestRef,
  TmsTestUpsert,
} from '@warden/core';
import { WardenError, stripTrailingSlashes } from '@warden/core';
import { defaultFetch, requestJson, type FetchLike } from '../fetch-like.js';
import { mapResultStatus } from './result-status.js';

export interface XrayAdapterOptions {
  /** Xray Cloud credential in `client_id:client_secret` form; exchanged for a bearer via authenticate. */
  token: string;
  /** Jira project key the tests live under (e.g. `CALC`). */
  project: string;
  /** Overrides the endpoint — defaults to Xray Cloud. */
  apiUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

interface XrayTestNode {
  jira?: { key?: string; summary?: string; labels?: string[] };
  coverableIssues?: { results?: { jira?: { key?: string } }[] };
}

interface XrayGetTestsResponse {
  data?: { getTests?: { results?: XrayTestNode[] } };
}

interface XrayCreateResponse {
  data?: { createTest?: { test?: { jira?: { key?: string } } } };
}

/**
 * Xray adapter — Jira-native, `sourceCodeFirst: false`. Its Requirement→Test→Execution model maps
 * directly onto Warden's Xray-inspired schema, so requirement links round-trip with the highest
 * fidelity after testomat.io. Reads test issues via GraphQL; pushes an execution import.
 */
export class XrayAdapter implements TestManagementSync {
  readonly source = 'xray' as const;
  readonly sourceCodeFirst = false;

  private readonly token: string;
  private readonly project: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;
  private bearer?: string;

  constructor(opts: XrayAdapterOptions) {
    this.token = opts.token;
    this.project = opts.project;
    this.apiUrl = stripTrailingSlashes(opts.apiUrl ?? 'https://xray.cloud.getxray.app');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
  }

  async pullCatalog(): Promise<SpecCatalogEntry[]> {
    const query = `query { getTests(jql: "project = ${this.project}", limit: 100) {
      results { jira(fields: ["key", "summary", "labels"]) coverableIssues { results { jira(fields: ["key"]) } } }
    } }`;
    const body = (await this.graphql(query)) as XrayGetTestsResponse;

    return (body.data?.getTests?.results ?? []).map((node) => ({
      externalId: node.jira?.key ?? '',
      title: node.jira?.summary ?? '',
      tags: node.jira?.labels ?? [],
      requirementIds: (node.coverableIssues?.results ?? [])
        .map((issue) => issue.jira?.key)
        .filter((key): key is string => Boolean(key)),
      automation: 'manual' as const,
    }));
  }

  async upsertTest(test: TmsTestUpsert): Promise<TmsTestRef> {
    if (test.externalId) {
      const mutation = `mutation { updateTestType(issueId: "${test.externalId}", testType: {name: "Generic"}) { issueId } }`;
      await this.graphql(mutation);
      return { externalId: test.externalId };
    }

    const mutation = `mutation { createTest(testType: {name: "Generic"}, jira: {fields: {summary: ${JSON.stringify(
      test.title,
    )}, project: {key: "${this.project}"}}}) { test { jira(fields: ["key"]) } } }`;
    const body = (await this.graphql(mutation)) as XrayCreateResponse;
    return { externalId: body.data?.createTest?.test?.jira?.key ?? '' };
  }

  async pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void> {
    if (results.length === 0) return;
    const bearer = await this.authenticate();

    await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/api/v2/import/execution`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({
          info: {
            summary: `Warden run ${meta.runRef}`,
            project: this.project,
            environments: [meta.environment],
            startDate: meta.startedAt.toISOString(),
            finishDate: meta.completedAt?.toISOString(),
          },
          tests: results.map((result) => ({
            testKey: result.externalId,
            status: mapResultStatus('xray', result.status).status,
            comment: result.errorMessage,
          })),
        }),
      },
      'TMS_XRAY_REQUEST_FAILED',
    );
  }

  private async authenticate(): Promise<string> {
    if (this.bearer) return this.bearer;
    const [clientId, clientSecret] = this.token.split(':');
    if (!clientId || !clientSecret) {
      throw new WardenError(
        'Xray token must be in "client_id:client_secret" form',
        'TMS_MISSING_CONFIG',
      );
    }
    const body = await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/api/v2/authenticate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
      },
      'TMS_XRAY_REQUEST_FAILED',
    );
    this.bearer = String(body);
    return this.bearer;
  }

  private async graphql(query: string): Promise<unknown> {
    const bearer = await this.authenticate();
    return requestJson(
      this.fetchImpl,
      `${this.apiUrl}/api/v2/graphql`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ query }),
      },
      'TMS_XRAY_REQUEST_FAILED',
    );
  }
}
