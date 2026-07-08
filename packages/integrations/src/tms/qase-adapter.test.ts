import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like.js';
import { QaseAdapter } from './qase-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

function makeAdapter(fetchImpl: FetchLike) {
  return new QaseAdapter({ token: 'qase_key', project: 'DEMO', fetchImpl });
}

const meta = { runRef: 'PR-1', environment: 'ci', startedAt: new Date('2026-07-07T00:00:00Z') };

describe('QaseAdapter', () => {
  it('is not source-code-first', () => {
    expect(makeAdapter(vi.fn<FetchLike>()).sourceCodeFirst).toBe(false);
  });

  it('pulls cases into SpecCatalogEntry[]', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        result: {
          entities: [
            {
              id: 42,
              title: 'Login works',
              priority: 3,
              automation: 2,
              tags: [{ title: 'smoke' }],
              external_issues: ['JIRA-9'],
            },
          ],
        },
      }),
    );
    const catalog = await makeAdapter(fetchImpl).pullCatalog();

    expect(catalog).toEqual([
      {
        externalId: '42',
        title: 'Login works',
        tags: ['smoke'],
        requirementIds: ['JIRA-9'],
        automation: 'automated',
        priority: 'P1',
      },
    ]);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.qase.io/v1/case/DEMO?limit=100');
  });

  it('creates a case (POST) when no externalId is given', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ result: { id: 77 } }));
    const ref = await makeAdapter(fetchImpl).upsertTest({
      title: 'New',
      tags: [],
      requirementIds: [],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(ref.externalId).toBe('77');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.qase.io/v1/case/DEMO');
    expect(init?.method).toBe('POST');
  });

  it('updates a case (PATCH) when an externalId is present', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ status: true }));
    const ref = await makeAdapter(fetchImpl).upsertTest({
      externalId: '42',
      title: 'Updated',
      tags: [],
      requirementIds: [],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(ref.externalId).toBe('42');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.qase.io/v1/case/DEMO/42');
    expect(init?.method).toBe('PATCH');
  });

  it('pushes results as a run then a bulk result post', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ result: { id: 7 } }))
      .mockResolvedValueOnce(jsonResponse({ status: true }));
    await makeAdapter(fetchImpl).pushResults(
      [{ externalId: '42', status: 'PASS', durationMs: 1200 }],
      meta,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.qase.io/v1/run/DEMO');
    const [bulkUrl, bulkInit] = fetchImpl.mock.calls[1]!;
    expect(bulkUrl).toBe('https://api.qase.io/v1/result/DEMO/7/bulk');
    const payload = JSON.parse(bulkInit?.body as string);
    expect(payload.results).toEqual([{ case_id: 42, status: 'passed', time_ms: 1200 }]);
  });
});
