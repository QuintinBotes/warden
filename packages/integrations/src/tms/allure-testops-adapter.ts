import type {
  SpecCatalogEntry,
  TestManagementSync,
  TmsResultPush,
  TmsRunMeta,
  TmsTestRef,
  TmsTestUpsert,
} from '@warden/core';
import { stripTrailingSlashes } from '@warden/core';
import { defaultFetch, requestJson, type FetchLike } from '../fetch-like.js';
import { mapResultStatus } from './result-status.js';

export interface AllureTestOpsAdapterOptions {
  /** Allure TestOps API bearer token. */
  token: string;
  /** Allure TestOps numeric project id (as a string). */
  project: string;
  /** Self-hosted Allure TestOps base URL. Required. */
  apiUrl: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

interface AllureTestCase {
  id: number;
  name: string;
  tags?: ({ name: string } | string)[];
  automated?: boolean;
  issueKeys?: string[];
}

interface AllureListResponse {
  content?: AllureTestCase[];
}

interface AllureIdResponse {
  id?: number;
}

function tagNames(tags: AllureTestCase['tags']): string[] {
  return (tags ?? []).map((tag) => (typeof tag === 'string' ? tag : tag.name));
}

/** Allure TestOps adapter — test-cases → catalog, launches + results → run. Stable id = `AS-<id>`. */
export class AllureTestOpsAdapter implements TestManagementSync {
  readonly source = 'allure-testops' as const;
  readonly sourceCodeFirst = false;

  private readonly token: string;
  private readonly project: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: AllureTestOpsAdapterOptions) {
    this.token = opts.token;
    this.project = opts.project;
    this.apiUrl = stripTrailingSlashes(opts.apiUrl);
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
  }

  async pullCatalog(): Promise<SpecCatalogEntry[]> {
    const url = `${this.apiUrl}/api/testcase?projectId=${encodeURIComponent(this.project)}&page=0&size=100`;
    const body = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'GET', headers: this.headers() },
      'TMS_ALLURE_REQUEST_FAILED',
    )) as AllureListResponse;

    return (body.content ?? []).map((testCase) => ({
      externalId: `AS-${testCase.id}`,
      title: testCase.name,
      tags: tagNames(testCase.tags),
      requirementIds: testCase.issueKeys ?? [],
      automation: testCase.automated ? 'automated' : 'manual',
    }));
  }

  async upsertTest(test: TmsTestUpsert): Promise<TmsTestRef> {
    if (test.externalId) {
      await requestJson(
        this.fetchImpl,
        `${this.apiUrl}/api/testcase/${this.numericId(test.externalId)}`,
        {
          method: 'PATCH',
          headers: this.headers(),
          body: JSON.stringify({ name: test.title, automated: true }),
        },
        'TMS_ALLURE_REQUEST_FAILED',
      );
      return { externalId: test.externalId };
    }

    const body = (await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/api/testcase`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          projectId: Number(this.project),
          name: test.title,
          automated: test.source !== 'manual',
        }),
      },
      'TMS_ALLURE_REQUEST_FAILED',
    )) as AllureIdResponse;
    return { externalId: `AS-${body.id ?? ''}` };
  }

  async pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void> {
    if (results.length === 0) return;

    const launch = (await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/api/launch`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          projectId: Number(this.project),
          name: `Warden run ${meta.runRef}`,
          environment: meta.environment,
        }),
      },
      'TMS_ALLURE_REQUEST_FAILED',
    )) as AllureIdResponse;

    for (const result of results) {
      await requestJson(
        this.fetchImpl,
        `${this.apiUrl}/api/testresult`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            launchId: launch.id,
            testCaseId: this.numericId(result.externalId),
            status: mapResultStatus('allure-testops', result.status).status,
            duration: result.durationMs,
            message: result.errorMessage,
          }),
        },
        'TMS_ALLURE_REQUEST_FAILED',
      );
    }
  }

  private numericId(externalId: string): number {
    return Number(externalId.replace(/^AS-/, ''));
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
  }
}
