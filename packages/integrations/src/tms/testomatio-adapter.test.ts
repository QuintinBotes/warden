import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like.js';
import { TestomatioAdapter } from './testomatio-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

const TEST_DATA_FIXTURE = {
  tests: [
    {
      id: '@T1a2b3c4d',
      title: 'Checkout supports Apple Pay',
      tags: ['smoke', 'checkout'],
      issues: ['JIRA-100'],
      priority: 'high',
      state: 'automated',
      file: 'tests/e2e/checkout.spec.ts',
      test_name: 'checkout supports apple pay',
      framework: 'playwright',
      bdd_steps: ['Given a cart', 'When I pay', 'Then it succeeds'],
    },
    {
      id: '@Tdeadbeef',
      title: 'Manual smoke of admin panel',
      state: 'manual',
    },
  ],
};

function makeAdapter(fetchImpl: FetchLike, opts: { resultChunkSize?: number } = {}) {
  return new TestomatioAdapter({
    token: 'tm_key_x',
    project: 'proj-1',
    fetchImpl,
    resultChunkSize: opts.resultChunkSize,
  });
}

describe('TestomatioAdapter', () => {
  it('is source-code-first', () => {
    const adapter = makeAdapter(vi.fn<FetchLike>());
    expect(adapter.source).toBe('testomatio');
    expect(adapter.sourceCodeFirst).toBe(true);
  });

  describe('pullCatalog', () => {
    it('maps test_data into SpecCatalogEntry[] with sourceRef for automated tests', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(TEST_DATA_FIXTURE));
      const catalog = await makeAdapter(fetchImpl).pullCatalog();

      expect(catalog).toEqual([
        {
          externalId: '@T1a2b3c4d',
          title: 'Checkout supports Apple Pay',
          tags: ['smoke', 'checkout'],
          requirementIds: ['JIRA-100'],
          automation: 'automated',
          priority: 'P1',
          bddSteps: ['Given a cart', 'When I pay', 'Then it succeeds'],
          sourceRef: {
            filePath: 'tests/e2e/checkout.spec.ts',
            testName: 'checkout supports apple pay',
            framework: 'playwright',
          },
        },
        {
          externalId: '@Tdeadbeef',
          title: 'Manual smoke of admin panel',
          tags: [],
          requirementIds: [],
          automation: 'manual',
        },
      ]);
    });

    it('GETs test_data with the api key in query and header', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(TEST_DATA_FIXTURE));
      await makeAdapter(fetchImpl).pullCatalog();

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://app.testomat.io/api/test_data?api_key=tm_key_x');
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('tm_key_x');
    });

    it('throws a typed WardenError on a non-2xx response', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, false, 500));
      await expect(makeAdapter(fetchImpl).pullCatalog()).rejects.toMatchObject({
        code: 'TMS_TESTOMATIO_REQUEST_FAILED',
      });
    });
  });

  describe('upsertTest', () => {
    it('POSTs to /api/tests to mint a new @T id when no externalId is given', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValue(
          jsonResponse({ id: '@Tnew123', url: 'https://app.testomat.io/t/@Tnew123' }),
        );
      const ref = await makeAdapter(fetchImpl).upsertTest({
        title: 'New generated test',
        tags: ['@smoke'],
        requirementIds: ['JIRA-1'],
        priority: 'P2',
        source: 'ai-generated',
        sourceRef: { filePath: 'a.spec.ts', testName: 'does a', framework: 'playwright' },
      });

      expect(ref).toEqual({ externalId: '@Tnew123', url: 'https://app.testomat.io/t/@Tnew123' });
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://app.testomat.io/api/tests?api_key=tm_key_x');
      expect(init?.method).toBe('POST');
      const payload = JSON.parse(init?.body as string);
      expect(payload).toMatchObject({
        title: 'New generated test',
        file: 'a.spec.ts',
        test_name: 'does a',
        issues: ['JIRA-1'],
      });
    });

    it('PATCHes /api/tests/{id} (stripping the @) when an externalId is present', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: '@T1a2b3c4d' }));
      const ref = await makeAdapter(fetchImpl).upsertTest({
        externalId: '@T1a2b3c4d',
        title: 'Renamed in code',
        tags: [],
        requirementIds: [],
        priority: 'P2',
        source: 'ai-generated',
      });

      expect(ref.externalId).toBe('@T1a2b3c4d');
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://app.testomat.io/api/tests/T1a2b3c4d?api_key=tm_key_x');
      expect(init?.method).toBe('PATCH');
    });
  });

  describe('pushResults', () => {
    const meta = {
      runRef: 'PR-482',
      environment: 'preview',
      startedAt: new Date('2026-07-07T12:00:00.000Z'),
      completedAt: new Date('2026-07-07T12:05:00.000Z'),
    };

    it('POSTs a reporter Run keyed by rid with mapped statuses', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true }));
      await makeAdapter(fetchImpl).pushResults(
        [
          { externalId: '@T1a2b3c4d', status: 'PASS', durationMs: 1200 },
          { externalId: '@Tdeadbeef', status: 'FAIL', durationMs: 800, errorMessage: 'boom' },
          { externalId: '@Tflaky', status: 'FLAKY', durationMs: 500 },
        ],
        meta,
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://app.testomat.io/api/reporter?api_key=tm_key_x');
      const payload = JSON.parse(init?.body as string);
      expect(payload.title).toBe('PR-482');
      expect(payload.tests).toEqual([
        { rid: '@T1a2b3c4d', status: 'passed', flaky: false, run_time: 1200 },
        { rid: '@Tdeadbeef', status: 'failed', flaky: false, message: 'boom', run_time: 800 },
        { rid: '@Tflaky', status: 'passed', flaky: true, run_time: 500 },
      ]);
    });

    it('chunks oversized runs into multiple reporter POSTs', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ ok: true }));
      await makeAdapter(fetchImpl, { resultChunkSize: 2 }).pushResults(
        [
          { externalId: '@T1', status: 'PASS', durationMs: 1 },
          { externalId: '@T2', status: 'PASS', durationMs: 1 },
          { externalId: '@T3', status: 'PASS', durationMs: 1 },
        ],
        meta,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('does nothing (no request) for an empty result set', async () => {
      const fetchImpl = vi.fn<FetchLike>();
      await makeAdapter(fetchImpl).pushResults([], meta);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
