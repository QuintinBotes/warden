import type {
  Priority,
  SpecCatalogEntry,
  TestManagementSync,
  TmsResultPush,
  TmsRunMeta,
  TmsTestRef,
  TmsTestUpsert,
} from '@warden/core';
import { defaultFetch, requestJson, type FetchLike } from '../fetch-like.js';
import { mapResultStatus } from './result-status.js';

export interface TestRailAdapterOptions {
  /** Basic-auth credential in `email:api_key` form; base64-encoded into `Authorization: Basic`. */
  token: string;
  /** TestRail project id (used as the section id for the create-case outline). */
  project: string;
  /** Self-hosted TestRail base URL, e.g. `https://acme.testrail.io`. Required. */
  apiUrl: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

interface TestRailCase {
  id: number;
  title: string;
  priority_id?: number;
  refs?: string;
  custom_automation_type?: number;
}

/** TestRail wraps paginated results in `{ cases }`; older servers return a bare array. */
interface TestRailCasesResponse {
  cases?: TestRailCase[];
}

interface TestRailIdResponse {
  id?: number;
}

/** TestRail `priority_id` (default 1=Low … 4=Critical) → Warden `Priority`. */
function mapPriority(priorityId: number | undefined): Priority | undefined {
  if (priorityId === undefined) return undefined;
  if (priorityId >= 3) return 'P1';
  if (priorityId === 2) return 'P2';
  return 'P3';
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

/** TestRail adapter — `get_cases` → catalog, `add_results_for_cases` → run results. */
export class TestRailAdapter implements TestManagementSync {
  readonly source = 'testrail' as const;
  readonly sourceCodeFirst = false;

  private readonly token: string;
  private readonly project: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: TestRailAdapterOptions) {
    this.token = opts.token;
    this.project = opts.project;
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
  }

  async pullCatalog(): Promise<SpecCatalogEntry[]> {
    const body = (await requestJson(
      this.fetchImpl,
      this.endpoint(`get_cases/${this.project}`),
      { method: 'GET', headers: this.headers() },
      'TMS_TESTRAIL_REQUEST_FAILED',
    )) as TestRailCasesResponse | TestRailCase[];

    const cases = Array.isArray(body) ? body : (body.cases ?? []);
    return cases.map((testCase) => {
      const entry: SpecCatalogEntry = {
        externalId: `C${testCase.id}`,
        title: testCase.title,
        tags: [],
        requirementIds: (testCase.refs ?? '')
          .split(',')
          .map((ref) => ref.trim())
          .filter((ref) => ref.length > 0),
        automation: testCase.custom_automation_type ? 'automated' : 'manual',
      };
      const priority = mapPriority(testCase.priority_id);
      if (priority) entry.priority = priority;
      return entry;
    });
  }

  async upsertTest(test: TmsTestUpsert): Promise<TmsTestRef> {
    const payload = {
      title: test.title,
      refs: test.requirementIds.join(','),
    };

    if (test.externalId) {
      const caseId = this.numericId(test.externalId);
      await requestJson(
        this.fetchImpl,
        this.endpoint(`update_case/${caseId}`),
        { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) },
        'TMS_TESTRAIL_REQUEST_FAILED',
      );
      return { externalId: test.externalId };
    }

    const body = (await requestJson(
      this.fetchImpl,
      this.endpoint(`add_case/${this.project}`),
      { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) },
      'TMS_TESTRAIL_REQUEST_FAILED',
    )) as TestRailIdResponse;
    return { externalId: `C${body.id ?? ''}` };
  }

  async pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void> {
    if (results.length === 0) return;

    const run = (await requestJson(
      this.fetchImpl,
      this.endpoint(`add_run/${this.project}`),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ name: `${meta.runRef} (${meta.environment})` }),
      },
      'TMS_TESTRAIL_REQUEST_FAILED',
    )) as TestRailIdResponse;

    await requestJson(
      this.fetchImpl,
      this.endpoint(`add_results_for_cases/${run.id}`),
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          results: results.map((result) => ({
            case_id: this.numericId(result.externalId),
            status_id: mapResultStatus('testrail', result.status).status,
            elapsed: `${Math.max(1, Math.round(result.durationMs / 1000))}s`,
            comment: result.errorMessage,
          })),
        }),
      },
      'TMS_TESTRAIL_REQUEST_FAILED',
    );
  }

  private numericId(externalId: string): number {
    return Number(externalId.replace(/^C/, ''));
  }

  private endpoint(path: string): string {
    return `${this.apiUrl}/index.php?/api/v2/${path}`;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${base64(this.token)}`,
    };
  }
}
