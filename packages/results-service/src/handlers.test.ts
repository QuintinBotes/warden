import { describe, expect, it } from 'vitest';
import { fixtureExecution } from '@warden/core/testing';
import type {
  CoverageCell,
  DashboardDataApi,
  DateRange,
  FlakeStat,
  Requirement,
  TestExecution,
  TrendPoint,
  WardenConfig,
} from '@warden/core';
import { createResultsFacade } from './results-facade.js';
import { createHmacSigner } from './hmac-signer.js';
import { mintShareToken } from './share.js';
import {
  createShareHandler,
  getRunHandler,
  listRunsHandler,
  sharedRunHandler,
  type HandlerDeps,
} from './handlers.js';

const NOW = 1_700_000_000_000;
const SECRET = 'test-secret';

function fakeDashboardApi(executions: TestExecution[]): DashboardDataApi {
  return {
    async executions(_range: DateRange): Promise<TestExecution[]> {
      return executions;
    },
    async listRequirements(): Promise<Requirement[]> {
      return [];
    },
    async coverageMatrix(): Promise<CoverageCell[]> {
      return [];
    },
    async flakeBoard(): Promise<FlakeStat[]> {
      return [];
    },
    async trends(): Promise<TrendPoint[]> {
      return [];
    },
  };
}

function makeDeps(
  executions: TestExecution[],
  cfg: Partial<WardenConfig['resultsService']> = {},
): HandlerDeps {
  const api = fakeDashboardApi(executions);
  return {
    facade: createResultsFacade(api),
    signer: createHmacSigner(SECRET),
    now: () => NOW,
    cfg: {
      resultsService: {
        enabled: true,
        tokenTtlSec: 3_600,
        publicBaseUrl: 'https://results.example.test',
        ...cfg,
      },
    },
  };
}

const RANGE: DateRange = { from: new Date(0), to: new Date(NOW) };

describe('listRunsHandler', () => {
  it('returns 200 with the shared summaries', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-1' }), fixtureExecution({ id: 'EX-2' })]);
    const res = await listRunsHandler(deps, RANGE);
    expect(res.status).toBe(200);
    const body = res.body as Array<{ executionId: string }>;
    expect(body.map((r) => r.executionId)).toEqual(['EX-1', 'EX-2']);
  });
});

describe('getRunHandler', () => {
  it('returns 200 with the run for a known id', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-7' })]);
    const res = await getRunHandler(deps, 'EX-7');
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe('EX-7');
  });

  it('returns 404 for an unknown id', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-7' })]);
    const res = await getRunHandler(deps, 'nope');
    expect(res.status).toBe(404);
  });
});

describe('createShareHandler', () => {
  it('mints a share URL under the configured public base url', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-7' })]);
    const res = await createShareHandler(deps, 'EX-7');
    expect(res.status).toBe(201);
    const { url } = res.body as { url: string };
    expect(url.startsWith('https://results.example.test/share/')).toBe(true);
    // the minted token resolves back to the execution id
    const token = url.slice('https://results.example.test/share/'.length);
    expect(deps.signer.verify(token, NOW + 1)?.executionId).toBe('EX-7');
  });

  it('does not double up slashes when the base url has a trailing slash', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-7' })], {
      publicBaseUrl: 'https://results.example.test/',
    });
    const res = await createShareHandler(deps, 'EX-7');
    const { url } = res.body as { url: string };
    expect(url).not.toContain('//share');
    expect(url.startsWith('https://results.example.test/share/')).toBe(true);
  });
});

describe('sharedRunHandler', () => {
  it('returns 200 with the redacted public view for a valid token', async () => {
    const exec = fixtureExecution({
      id: 'EX-7',
      results: [
        {
          testCaseId: 'TC-1',
          status: 'FAIL',
          duration: 12,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
          errorMessage: 'internal-only-detail',
        },
      ],
    });
    const deps = makeDeps([exec]);
    const token = mintShareToken('EX-7', deps.signer, NOW, 3_600);
    const res = await sharedRunHandler(deps, token);
    expect(res.status).toBe(200);
    const body = res.body as { summary: { executionId: string }; results: unknown[] };
    expect(body.summary.executionId).toBe('EX-7');
    expect(JSON.stringify(body)).not.toContain('internal-only-detail');
  });

  it('returns 410 for an expired token', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-7' })]);
    const token = mintShareToken('EX-7', deps.signer, NOW - 10_000, 5); // expired at NOW-5s
    const res = await sharedRunHandler(deps, token);
    expect(res.status).toBe(410);
  });

  it('returns 404 for a tampered / unknown token', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-7' })]);
    const res = await sharedRunHandler(deps, 'garbage.token');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the token is valid but the run no longer exists', async () => {
    const deps = makeDeps([]); // no executions
    const token = mintShareToken('EX-GONE', deps.signer, NOW, 3_600);
    const res = await sharedRunHandler(deps, token);
    expect(res.status).toBe(404);
  });
});
