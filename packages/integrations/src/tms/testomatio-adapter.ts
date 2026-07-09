import type {
  Priority,
  SourceCodeRef,
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

export interface TestomatioAdapterOptions {
  /** testomat.io API key, sent as `X-Api-Key` (and as the `api_key` query param the tool expects). */
  token: string;
  /** Project id/prefix in testomat.io. */
  project: string;
  /** Overrides the endpoint — defaults to the public testomat.io app. */
  apiUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Max per-test results per reporter POST; oversized runs are chunked. */
  resultChunkSize?: number;
}

/** One test row as returned by testomat.io's `test_data` export. */
interface TestomatioTest {
  id: string; // `@T…`
  title: string;
  tags?: string[];
  issues?: string[];
  priority?: string;
  state?: 'automated' | 'manual';
  file?: string;
  test_name?: string;
  framework?: string;
  bdd_steps?: string[];
}

interface TestDataResponse {
  tests?: TestomatioTest[];
}

interface UpsertResponse {
  id?: string;
  url?: string;
}

/** testomat.io priority → Warden `Priority`. Unknown / absent falls back to `P2`. */
function mapPriority(priority: string | undefined): Priority | undefined {
  if (priority === undefined) return undefined;
  const normalized = priority.trim().toLowerCase();
  if (['high', 'important', 'critical', 'p1'].includes(normalized)) return 'P1';
  if (['low', 'minor', 'p3'].includes(normalized)) return 'P3';
  return 'P2';
}

function mapFramework(framework: string | undefined): SourceCodeRef['framework'] {
  if (framework === 'cypress' || framework === 'codeceptjs' || framework === 'gherkin') {
    return framework;
  }
  return 'playwright';
}

/**
 * Source-code-first adapter for testomat.io. testomat.io imports automated tests from code, assigns
 * each a stable `@T…` id, and expects that id to be written back into the source — so a rename in
 * code is a metadata update keyed by the stable id, never a new test.
 */
export class TestomatioAdapter implements TestManagementSync {
  readonly source = 'testomatio' as const;
  readonly sourceCodeFirst = true;

  private readonly token: string;
  private readonly project: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly resultChunkSize: number;

  constructor(opts: TestomatioAdapterOptions) {
    this.token = opts.token;
    this.project = opts.project;
    this.apiUrl = stripTrailingSlashes(opts.apiUrl ?? 'https://app.testomat.io');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
    this.resultChunkSize = opts.resultChunkSize ?? 100;
  }

  async pullCatalog(): Promise<SpecCatalogEntry[]> {
    const url = `${this.apiUrl}/api/test_data?api_key=${encodeURIComponent(this.token)}`;
    const body = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'GET', headers: this.headers() },
      'TMS_TESTOMATIO_REQUEST_FAILED',
    )) as TestDataResponse;

    return (body.tests ?? []).map((test) => {
      const automation = test.state === 'manual' ? 'manual' : 'automated';
      const entry: SpecCatalogEntry = {
        externalId: test.id,
        title: test.title,
        tags: test.tags ?? [],
        requirementIds: test.issues ?? [],
        automation,
      };
      const priority = mapPriority(test.priority);
      if (priority) entry.priority = priority;
      if (test.bdd_steps && test.bdd_steps.length > 0) entry.bddSteps = test.bdd_steps;
      if (automation === 'automated' && test.file && test.test_name) {
        entry.sourceRef = {
          filePath: test.file,
          testName: test.test_name,
          framework: mapFramework(test.framework),
        };
      }
      return entry;
    });
  }

  async upsertTest(test: TmsTestUpsert): Promise<TmsTestRef> {
    const payload = {
      title: test.title,
      tags: test.tags,
      issues: test.requirementIds,
      priority: test.priority,
      source: test.source,
      file: test.sourceRef?.filePath,
      test_name: test.sourceRef?.testName,
      framework: test.sourceRef?.framework,
      bdd_steps: test.bddSteps,
    };

    if (test.externalId) {
      // Update: id is stable, only title / tags / links change.
      const url = `${this.apiUrl}/api/tests/${this.idPath(test.externalId)}?api_key=${encodeURIComponent(this.token)}`;
      const body = (await requestJson(
        this.fetchImpl,
        url,
        { method: 'PATCH', headers: this.headers(), body: JSON.stringify(payload) },
        'TMS_TESTOMATIO_REQUEST_FAILED',
      )) as UpsertResponse;
      return { externalId: body.id ?? test.externalId, url: body.url };
    }

    // Create: testomat.io mints a stable `@T…` id from title + sourceRef.
    const url = `${this.apiUrl}/api/tests?api_key=${encodeURIComponent(this.token)}`;
    const body = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) },
      'TMS_TESTOMATIO_REQUEST_FAILED',
    )) as UpsertResponse;
    if (!body.id) {
      throw new Error('testomat.io create returned no id'); // requestJson already guards non-2xx
    }
    return { externalId: body.id, url: body.url };
  }

  async pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void> {
    if (results.length === 0) return;
    const url = `${this.apiUrl}/api/reporter?api_key=${encodeURIComponent(this.token)}`;

    for (const chunk of this.chunk(results)) {
      const payload = {
        title: meta.runRef,
        env: meta.environment,
        started_at: meta.startedAt.toISOString(),
        finished_at: meta.completedAt?.toISOString(),
        tests: chunk.map((result) => {
          const mapping = mapResultStatus('testomatio', result.status);
          return {
            rid: result.externalId,
            status: mapping.status,
            flaky: mapping.flaky ?? false,
            message: result.errorMessage,
            run_time: result.durationMs,
          };
        }),
      };
      await requestJson(
        this.fetchImpl,
        url,
        { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) },
        'TMS_TESTOMATIO_REQUEST_FAILED',
      );
    }
  }

  private idPath(externalId: string): string {
    return encodeURIComponent(externalId.replace(/^@/, ''));
  }

  private chunk(results: TmsResultPush[]): TmsResultPush[][] {
    const batches: TmsResultPush[][] = [];
    for (let i = 0; i < results.length; i += this.resultChunkSize) {
      batches.push(results.slice(i, i + this.resultChunkSize));
    }
    return batches;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.token,
      'X-Project': this.project,
    };
  }
}
