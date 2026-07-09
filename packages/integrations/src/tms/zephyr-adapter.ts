import type {
  Priority,
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

export interface ZephyrAdapterOptions {
  /** Zephyr Scale API bearer token. */
  token: string;
  /** Jira project key (e.g. `ZE`). */
  project: string;
  /** Overrides the endpoint — defaults to Zephyr Scale Cloud. */
  apiUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

interface ZephyrTestCase {
  key: string;
  name: string;
  priorityName?: string;
  labels?: string[];
  automated?: boolean;
  issueLinks?: string[];
}

interface ZephyrListResponse {
  values?: ZephyrTestCase[];
}

interface ZephyrKeyResponse {
  key?: string;
}

/** Zephyr Scale priority name → Warden `Priority`. */
function mapPriority(priorityName: string | undefined): Priority | undefined {
  if (priorityName === undefined) return undefined;
  const normalized = priorityName.trim().toLowerCase();
  if (['high', 'critical', 'highest'].includes(normalized)) return 'P1';
  if (['low', 'lowest', 'minor'].includes(normalized)) return 'P3';
  return 'P2';
}

/** Zephyr Scale adapter — `/testcases` → catalog, `/testexecutions` under a cycle → results. */
export class ZephyrAdapter implements TestManagementSync {
  readonly source = 'zephyr' as const;
  readonly sourceCodeFirst = false;

  private readonly token: string;
  private readonly project: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: ZephyrAdapterOptions) {
    this.token = opts.token;
    this.project = opts.project;
    this.apiUrl = stripTrailingSlashes(opts.apiUrl ?? 'https://api.zephyrscale.smartbear.com/v2');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
  }

  async pullCatalog(): Promise<SpecCatalogEntry[]> {
    const url = `${this.apiUrl}/testcases?projectKey=${encodeURIComponent(this.project)}&maxResults=100`;
    const body = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'GET', headers: this.headers() },
      'TMS_ZEPHYR_REQUEST_FAILED',
    )) as ZephyrListResponse;

    return (body.values ?? []).map((testCase) => {
      const entry: SpecCatalogEntry = {
        externalId: testCase.key,
        title: testCase.name,
        tags: testCase.labels ?? [],
        requirementIds: testCase.issueLinks ?? [],
        automation: testCase.automated ? 'automated' : 'manual',
      };
      const priority = mapPriority(testCase.priorityName);
      if (priority) entry.priority = priority;
      return entry;
    });
  }

  async upsertTest(test: TmsTestUpsert): Promise<TmsTestRef> {
    if (test.externalId) {
      await requestJson(
        this.fetchImpl,
        `${this.apiUrl}/testcases/${test.externalId}`,
        {
          method: 'PUT',
          headers: this.headers(),
          body: JSON.stringify({ name: test.title, labels: test.tags }),
        },
        'TMS_ZEPHYR_REQUEST_FAILED',
      );
      return { externalId: test.externalId };
    }

    const body = (await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/testcases`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ projectKey: this.project, name: test.title, labels: test.tags }),
      },
      'TMS_ZEPHYR_REQUEST_FAILED',
    )) as ZephyrKeyResponse;
    return { externalId: body.key ?? '' };
  }

  async pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void> {
    if (results.length === 0) return;

    const cycle = (await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/testcycles`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ projectKey: this.project, name: `Warden run ${meta.runRef}` }),
      },
      'TMS_ZEPHYR_REQUEST_FAILED',
    )) as ZephyrKeyResponse;

    for (const result of results) {
      await requestJson(
        this.fetchImpl,
        `${this.apiUrl}/testexecutions`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            projectKey: this.project,
            testCaseKey: result.externalId,
            testCycleKey: cycle.key,
            statusName: mapResultStatus('zephyr', result.status).status,
            environmentName: meta.environment,
            executionTime: result.durationMs,
            comment: result.errorMessage,
          }),
        },
        'TMS_ZEPHYR_REQUEST_FAILED',
      );
    }
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
  }
}
