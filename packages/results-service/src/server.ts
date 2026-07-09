import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DashboardDataApi, DateRange, ShareTokenSigner, WardenConfig } from '@warden/core';
import { createResultsFacade } from './results-facade.js';
import {
  createShareHandler,
  getRunHandler,
  listRunsHandler,
  sharedRunHandler,
  type HandlerDeps,
  type HandlerResult,
} from './handlers.js';

/** Everything `createResultsServer` needs, all injected — never a real socket or clock. */
export interface ResultsServerDeps {
  api: DashboardDataApi;
  signer: ShareTokenSigner;
  /** Injected clock returning epoch milliseconds. */
  now: () => number;
  cfg: { resultsService: WardenConfig['resultsService'] };
}

function toHandlerDeps(deps: ResultsServerDeps): HandlerDeps {
  return {
    facade: createResultsFacade(deps.api),
    signer: deps.signer,
    now: deps.now,
    cfg: deps.cfg,
  };
}

const RUN_ID = /^\/api\/runs\/([^/]+)$/;
const RUN_SHARE = /^\/api\/runs\/([^/]+)\/share$/;
const SHARE = /^\/share\/([^/]+)$/;

function parseRange(url: URL, nowMs: number): DateRange {
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  return {
    from: fromParam ? parseDate(fromParam) : new Date(0),
    to: toParam ? parseDate(toParam) : new Date(nowMs),
  };
}

function parseDate(raw: string): Date {
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) && raw.trim() !== '' ? new Date(asNumber) : new Date(raw);
}

async function route(deps: HandlerDeps, method: string, rawUrl: string): Promise<HandlerResult> {
  const url = new URL(rawUrl, 'http://localhost');
  const path = url.pathname;

  if (method === 'GET' && path === '/api/runs') {
    return listRunsHandler(deps, parseRange(url, deps.now()));
  }

  const shareMatch = RUN_SHARE.exec(path);
  if (method === 'POST' && shareMatch) {
    return createShareHandler(deps, decodeURIComponent(shareMatch[1]!));
  }

  const runMatch = RUN_ID.exec(path);
  if (method === 'GET' && runMatch) {
    return getRunHandler(deps, decodeURIComponent(runMatch[1]!));
  }

  const sharedMatch = SHARE.exec(path);
  if (method === 'GET' && sharedMatch) {
    return sharedRunHandler(deps, decodeURIComponent(sharedMatch[1]!));
  }

  return { status: 404, body: { error: 'not_found' } };
}

function send(res: ServerResponse, result: HandlerResult): void {
  const json = JSON.stringify(result.body ?? null);
  res.writeHead(result.status, { 'content-type': 'application/json' });
  res.end(json);
}

/**
 * The bare `(req, res)` listener, exposed so it can be driven directly in hermetic tests with
 * fake request/response objects — no socket, no port.
 */
export function createResultsRequestListener(
  deps: ResultsServerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  const handlerDeps = toHandlerDeps(deps);
  return (req, res) => {
    void route(handlerDeps, req.method ?? 'GET', req.url ?? '/')
      .then((result) => send(res, result))
      .catch(() => send(res, { status: 500, body: { error: 'internal_error' } }));
  };
}

/**
 * Build the results HTTP server. Routes `GET /api/runs`, `GET /api/runs/:id`,
 * `POST /api/runs/:id/share`, and `GET /share/:token`. It is NEVER auto-started on import —
 * a thin entry (`server-entry.mjs`) binds the port.
 */
export function createResultsServer(deps: ResultsServerDeps): Server {
  return createServer(createResultsRequestListener(deps));
}
