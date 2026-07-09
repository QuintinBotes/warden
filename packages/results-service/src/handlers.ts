import type { DateRange, ShareTokenSigner, WardenConfig } from '@warden/core';
import type { ResultsFacade } from './results-facade.js';
import { buildRunView, type RunView } from './run-view.js';
import { mintShareToken } from './share.js';

/** A pure handler outcome: an HTTP status plus a JSON-serializable body. */
export interface HandlerResult {
  status: number;
  body: unknown;
}

/** Strip trailing slashes in linear time (a regex like `/\/+$/` can backtrack on hostile input). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

/** Everything the handlers need, all injected — a facade, a signer, a clock, and config. */
export interface HandlerDeps {
  facade: ResultsFacade;
  signer: ShareTokenSigner;
  /** Injected clock returning epoch milliseconds. */
  now: () => number;
  cfg: { resultsService: WardenConfig['resultsService'] };
}

/** `GET /api/runs` — list run summaries in `range`. */
export async function listRunsHandler(deps: HandlerDeps, range: DateRange): Promise<HandlerResult> {
  const runs = await deps.facade.listRuns(range);
  return { status: 200, body: runs };
}

/** `GET /api/runs/:id` — the (internal) full execution, or 404. */
export async function getRunHandler(deps: HandlerDeps, id: string): Promise<HandlerResult> {
  const run = await deps.facade.getRun(id);
  if (!run) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: run };
}

/** `POST /api/runs/:id/share` — mint a public share link for the run. */
export function createShareHandler(deps: HandlerDeps, id: string): HandlerResult {
  const token = mintShareToken(id, deps.signer, deps.now(), deps.cfg.resultsService.tokenTtlSec);
  const base = stripTrailingSlashes(deps.cfg.resultsService.publicBaseUrl);
  return { status: 201, body: { url: `${base}/share/${token}` } };
}

/**
 * `GET /share/:token` — the public, redacted run view. Returns 200 for a valid token whose
 * run exists, 410 when the token's signature is valid but it has expired, and 404 for a
 * tampered/unknown token or a run that no longer exists.
 */
export async function sharedRunHandler(deps: HandlerDeps, token: string): Promise<HandlerResult> {
  const nowMs = deps.now();
  const payload = deps.signer.verify(token, nowMs);
  if (!payload) {
    // Distinguish an expired-but-authentic token from a forged one: re-verify ignoring
    // expiry (nowMs = 0). A well-formed, correctly-signed token has a positive `expiresAt`,
    // so it passes there iff its only defect was expiry.
    const authentic = deps.signer.verify(token, 0);
    if (authentic) return { status: 410, body: { error: 'expired' } };
    return { status: 404, body: { error: 'not_found' } };
  }

  const run = await deps.facade.getRun(payload.executionId);
  if (!run) return { status: 404, body: { error: 'not_found' } };
  const view: RunView = buildRunView(run);
  return { status: 200, body: view };
}
