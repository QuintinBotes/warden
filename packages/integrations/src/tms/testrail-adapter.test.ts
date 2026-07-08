import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like.js';
import { TestRailAdapter } from './testrail-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

function makeAdapter(fetchImpl: FetchLike) {
  return new TestRailAdapter({
    token: 'email:key',
    project: '1',
    apiUrl: 'https://acme.testrail.io',
    fetchImpl,
  });
}

const meta = { runRef: 'PR-1', environment: 'ci', startedAt: new Date('2026-07-07T00:00:00Z') };

describe('TestRailAdapter', () => {
  it('pulls get_cases into SpecCatalogEntry[] with C-prefixed ids', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        cases: [
          {
            id: 123,
            title: 'T',
            priority_id: 4,
            refs: 'JIRA-1, JIRA-2',
            custom_automation_type: 1,
          },
        ],
      }),
    );
    const catalog = await makeAdapter(fetchImpl).pullCatalog();

    expect(catalog).toEqual([
      {
        externalId: 'C123',
        title: 'T',
        tags: [],
        requirementIds: ['JIRA-1', 'JIRA-2'],
        automation: 'automated',
        priority: 'P1',
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://acme.testrail.io/index.php?/api/v2/get_cases/1');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('email:key').toString('base64')}`,
    );
  });

  it('handles a bare-array get_cases response (older servers)', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse([{ id: 5, title: 'Bare', refs: '' }]));
    const catalog = await makeAdapter(fetchImpl).pullCatalog();
    expect(catalog[0]?.externalId).toBe('C5');
    expect(catalog[0]?.requirementIds).toEqual([]);
  });

  it('creates a case via add_case when no externalId is given', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: 200 }));
    const ref = await makeAdapter(fetchImpl).upsertTest({
      title: 'New',
      tags: [],
      requirementIds: ['R-1'],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(ref.externalId).toBe('C200');
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://acme.testrail.io/index.php?/api/v2/add_case/1',
    );
  });

  it('pushes results via add_run then add_results_for_cases with numeric status_ids', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ id: 55 }))
      .mockResolvedValueOnce(jsonResponse({}));
    await makeAdapter(fetchImpl).pushResults(
      [{ externalId: 'C123', status: 'PASS', durationMs: 2000 }],
      meta,
    );

    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://acme.testrail.io/index.php?/api/v2/add_run/1',
    );
    const [resultsUrl, init] = fetchImpl.mock.calls[1]!;
    expect(resultsUrl).toBe('https://acme.testrail.io/index.php?/api/v2/add_results_for_cases/55');
    const payload = JSON.parse(init?.body as string);
    expect(payload.results).toEqual([{ case_id: 123, status_id: 1, elapsed: '2s' }]);
  });
});
