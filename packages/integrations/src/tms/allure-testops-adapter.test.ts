import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like.js';
import { AllureTestOpsAdapter } from './allure-testops-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

function makeAdapter(fetchImpl: FetchLike) {
  return new AllureTestOpsAdapter({
    token: 'allure_key',
    project: '7',
    apiUrl: 'https://allure.acme.io',
    fetchImpl,
  });
}

const meta = { runRef: 'PR-1', environment: 'ci', startedAt: new Date('2026-07-07T00:00:00Z') };

describe('AllureTestOpsAdapter', () => {
  it('pulls test-cases into SpecCatalogEntry[] with AS-prefixed ids', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        content: [
          {
            id: 9,
            name: 'Profile updates',
            tags: [{ name: 'smoke' }],
            automated: true,
            issueKeys: ['JIRA-4'],
          },
        ],
      }),
    );
    const catalog = await makeAdapter(fetchImpl).pullCatalog();

    expect(catalog).toEqual([
      {
        externalId: 'AS-9',
        title: 'Profile updates',
        tags: ['smoke'],
        requirementIds: ['JIRA-4'],
        automation: 'automated',
      },
    ]);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://allure.acme.io/api/testcase?projectId=7&page=0&size=100',
    );
    expect((fetchImpl.mock.calls[0]![1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer allure_key',
    );
  });

  it('creates (POST) and updates (PATCH) test cases with AS ids', async () => {
    const create = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: 12 }));
    const ref = await makeAdapter(create).upsertTest({
      title: 'New',
      tags: [],
      requirementIds: [],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(ref.externalId).toBe('AS-12');
    expect(create.mock.calls[0]![0]).toBe('https://allure.acme.io/api/testcase');

    const update = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}));
    await makeAdapter(update).upsertTest({
      externalId: 'AS-9',
      title: 'Renamed',
      tags: [],
      requirementIds: [],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(update.mock.calls[0]![0]).toBe('https://allure.acme.io/api/testcase/9');
    expect(update.mock.calls[0]![1]?.method).toBe('PATCH');
  });

  it('pushes results under a new launch', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ id: 500 }))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));
    await makeAdapter(fetchImpl).pushResults(
      [{ externalId: 'AS-9', status: 'SKIP', durationMs: 0 }],
      meta,
    );

    expect(fetchImpl.mock.calls[0]![0]).toBe('https://allure.acme.io/api/launch');
    const [resultUrl, init] = fetchImpl.mock.calls[1]!;
    expect(resultUrl).toBe('https://allure.acme.io/api/testresult');
    const payload = JSON.parse(init?.body as string);
    expect(payload).toMatchObject({ launchId: 500, testCaseId: 9, status: 'skipped' });
  });
});
