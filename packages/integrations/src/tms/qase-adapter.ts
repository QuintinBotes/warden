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

export interface QaseAdapterOptions {
  /** Qase API token, sent as the `Token` header. */
  token: string;
  /** Qase project code (e.g. `DEMO`). */
  project: string;
  /** Overrides the endpoint — defaults to the public Qase API. */
  apiUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

interface QaseCase {
  id: number;
  title: string;
  priority?: number;
  automation?: number;
  tags?: ({ title: string } | string)[];
  external_issues?: string[];
}

interface QaseListResponse {
  result?: { entities?: QaseCase[] };
}

interface QaseCreateResponse {
  result?: { id?: number };
}

/** Qase numeric priority → Warden `Priority` (higher value = higher priority). */
function mapPriority(priority: number | undefined): Priority | undefined {
  if (priority === undefined) return undefined;
  if (priority >= 3) return 'P1';
  if (priority === 2) return 'P2';
  return 'P3';
}

function tagTitles(tags: QaseCase['tags']): string[] {
  return (tags ?? []).map((tag) => (typeof tag === 'string' ? tag : tag.title));
}

/** Qase adapter — cases under a project (pull/upsert) plus bulk results into a run (push). */
export class QaseAdapter implements TestManagementSync {
  readonly source = 'qase' as const;
  readonly sourceCodeFirst = false;

  private readonly token: string;
  private readonly project: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: QaseAdapterOptions) {
    this.token = opts.token;
    this.project = opts.project;
    this.apiUrl = stripTrailingSlashes(opts.apiUrl ?? 'https://api.qase.io/v1');
    this.fetchImpl = opts.fetchImpl ?? defaultFetch();
  }

  async pullCatalog(): Promise<SpecCatalogEntry[]> {
    const url = `${this.apiUrl}/case/${this.project}?limit=100`;
    const body = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'GET', headers: this.headers() },
      'TMS_QASE_REQUEST_FAILED',
    )) as QaseListResponse;

    return (body.result?.entities ?? []).map((qaseCase) => {
      const entry: SpecCatalogEntry = {
        externalId: String(qaseCase.id),
        title: qaseCase.title,
        tags: tagTitles(qaseCase.tags),
        requirementIds: qaseCase.external_issues ?? [],
        automation: qaseCase.automation === 2 ? 'automated' : 'manual',
      };
      const priority = mapPriority(qaseCase.priority);
      if (priority) entry.priority = priority;
      return entry;
    });
  }

  async upsertTest(test: TmsTestUpsert): Promise<TmsTestRef> {
    const payload = {
      title: test.title,
      priority: test.priority,
      tags: test.tags,
      external_issues: test.requirementIds,
    };

    if (test.externalId) {
      const url = `${this.apiUrl}/case/${this.project}/${test.externalId}`;
      await requestJson(
        this.fetchImpl,
        url,
        { method: 'PATCH', headers: this.headers(), body: JSON.stringify(payload) },
        'TMS_QASE_REQUEST_FAILED',
      );
      return { externalId: test.externalId };
    }

    const url = `${this.apiUrl}/case/${this.project}`;
    const body = (await requestJson(
      this.fetchImpl,
      url,
      { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) },
      'TMS_QASE_REQUEST_FAILED',
    )) as QaseCreateResponse;
    return { externalId: String(body.result?.id ?? '') };
  }

  async pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void> {
    if (results.length === 0) return;

    const runBody = (await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/run/${this.project}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ title: meta.runRef, environment: meta.environment }),
      },
      'TMS_QASE_REQUEST_FAILED',
    )) as QaseCreateResponse;
    const runId = runBody.result?.id;

    await requestJson(
      this.fetchImpl,
      `${this.apiUrl}/result/${this.project}/${runId}/bulk`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          results: results.map((result) => ({
            case_id: Number(result.externalId),
            status: mapResultStatus('qase', result.status).status,
            time_ms: result.durationMs,
            comment: result.errorMessage,
          })),
        }),
      },
      'TMS_QASE_REQUEST_FAILED',
    );
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Token: this.token };
  }
}
