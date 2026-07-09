import { Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
} from '@warden/core';
import { createHmacSigner } from './hmac-signer.js';
import { mintShareToken } from './share.js';
import {
  createResultsRequestListener,
  createResultsServer,
  type ResultsServerDeps,
} from './server.js';

const NOW = 1_700_000_000_000;

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

function makeDeps(executions: TestExecution[]): ResultsServerDeps {
  return {
    api: fakeDashboardApi(executions),
    signer: createHmacSigner('test-secret'),
    now: () => NOW,
    cfg: {
      resultsService: {
        enabled: true,
        tokenTtlSec: 3_600,
        publicBaseUrl: 'https://results.example.test',
      },
    },
  };
}

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
}

/** A fake `ServerResponse` that captures the write without a socket. Resolves once `end` is called. */
function fakeRes(): { res: ServerResponse; done: Promise<CapturedResponse> } {
  let resolve!: (v: CapturedResponse) => void;
  const done = new Promise<CapturedResponse>((r) => (resolve = r));
  const captured: CapturedResponse = { statusCode: 0, headers: {}, body: '' };
  const res = {
    writeHead(status: number, headers: Record<string, unknown>) {
      captured.statusCode = status;
      captured.headers = headers;
      return this;
    },
    end(chunk?: unknown) {
      if (chunk != null) captured.body = String(chunk);
      resolve(captured);
      return this;
    },
  } as unknown as ServerResponse;
  return { res, done };
}

async function call(
  deps: ResultsServerDeps,
  method: string,
  url: string,
): Promise<CapturedResponse> {
  const listener = createResultsRequestListener(deps);
  const { res, done } = fakeRes();
  const req = { method, url } as unknown as IncomingMessage;
  listener(req, res);
  return done;
}

describe('createResultsServer', () => {
  it('returns an http.Server without listening', () => {
    const server = createResultsServer(makeDeps([]));
    expect(server).toBeInstanceOf(Server);
    expect(server.listening).toBe(false);
    server.close();
  });
});

describe('request routing', () => {
  it('GET /api/runs -> 200 list of summaries', async () => {
    const out = await call(makeDeps([fixtureExecution({ id: 'EX-1' })]), 'GET', '/api/runs');
    expect(out.statusCode).toBe(200);
    const body = JSON.parse(out.body) as Array<{ executionId: string }>;
    expect(body[0]!.executionId).toBe('EX-1');
  });

  it('GET /api/runs/:id -> 200 for a known run, 404 otherwise', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-1' })]);
    const ok = await call(deps, 'GET', '/api/runs/EX-1');
    expect(ok.statusCode).toBe(200);
    expect((JSON.parse(ok.body) as { id: string }).id).toBe('EX-1');
    const missing = await call(deps, 'GET', '/api/runs/nope');
    expect(missing.statusCode).toBe(404);
  });

  it('POST /api/runs/:id/share -> 201 with a share url', async () => {
    const out = await call(
      makeDeps([fixtureExecution({ id: 'EX-1' })]),
      'POST',
      '/api/runs/EX-1/share',
    );
    expect(out.statusCode).toBe(201);
    const { url } = JSON.parse(out.body) as { url: string };
    expect(url.startsWith('https://results.example.test/share/')).toBe(true);
  });

  it('GET /share/:token -> 200 public view for a valid token', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-1' })]);
    const token = mintShareToken('EX-1', deps.signer, NOW, 3_600);
    const out = await call(deps, 'GET', `/share/${token}`);
    expect(out.statusCode).toBe(200);
    expect((JSON.parse(out.body) as { summary: { executionId: string } }).summary.executionId).toBe(
      'EX-1',
    );
  });

  it('GET /share/:token -> 410 for an expired token', async () => {
    const deps = makeDeps([fixtureExecution({ id: 'EX-1' })]);
    const token = mintShareToken('EX-1', deps.signer, NOW - 10_000, 5);
    const out = await call(deps, 'GET', `/share/${token}`);
    expect(out.statusCode).toBe(410);
  });

  it('unknown route -> 404', async () => {
    const out = await call(makeDeps([]), 'GET', '/nope');
    expect(out.statusCode).toBe(404);
  });
});
