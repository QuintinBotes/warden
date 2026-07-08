import type { PiiScrubber, RawTrafficSession, TrafficStore, WardenConfig } from '@warden/core';

/**
 * A tiny, self-hostable collector the browser SDK POSTs consenting captures to. This is the
 * transport-agnostic core: it takes an already-parsed request and returns a response, so it is
 * hermetically testable without binding a port. The `deploy/` wrapper mounts it on `node:http`.
 *
 * It enforces the same safety posture as the pipeline at the edge: capture is refused unless
 * `traffic.enabled`, Do-Not-Track / GPC headers suppress capture when honored, non-consenting
 * sessions are dropped, and — critically — **every accepted session is scrubbed before it is
 * stored**, so no raw `RawTrafficSession` is ever persisted.
 */
export interface CollectorRequest {
  method: string;
  headers?: Record<string, string | undefined>;
  body: unknown;
}

export interface CollectorResponse {
  status: number;
  body: { status: string; accepted?: number; rejected?: number; error?: string };
}

export interface CollectorHandlerOptions {
  cfg: WardenConfig;
  store: TrafficStore;
  scrubber: PiiScrubber;
}

export type CollectorHandler = (req: CollectorRequest) => Promise<CollectorResponse>;

function headerTruthy(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function extractSessions(body: unknown): RawTrafficSession[] {
  if (
    body &&
    typeof body === 'object' &&
    Array.isArray((body as { sessions?: unknown }).sessions)
  ) {
    return (body as { sessions: RawTrafficSession[] }).sessions;
  }
  if (Array.isArray(body)) return body as RawTrafficSession[];
  if (body && typeof body === 'object') return [body as RawTrafficSession];
  return [];
}

function isConsenting(session: RawTrafficSession, cfg: WardenConfig): boolean {
  if (!cfg.traffic.consent.required) return true;
  return session?.consent?.granted === true;
}

function isValid(session: RawTrafficSession): boolean {
  return (
    !!session &&
    typeof session.url === 'string' &&
    Array.isArray(session.steps) &&
    typeof session.anonId === 'string'
  );
}

export function createCollectorHandler(opts: CollectorHandlerOptions): CollectorHandler {
  const { cfg, store, scrubber } = opts;

  return async (req: CollectorRequest): Promise<CollectorResponse> => {
    if (!cfg.traffic.enabled) {
      return { status: 404, body: { status: 'disabled', error: 'traffic capture is disabled' } };
    }
    if (req.method.toUpperCase() !== 'POST') {
      return { status: 405, body: { status: 'method-not-allowed' } };
    }
    const dnt =
      headerTruthy(req.headers?.dnt) ||
      headerTruthy(req.headers?.DNT) ||
      headerTruthy(req.headers?.['sec-gpc']);
    if (cfg.traffic.consent.honorDoNotTrack && dnt) {
      return { status: 202, body: { status: 'suppressed-dnt', accepted: 0 } };
    }

    const sessions = extractSessions(req.body);
    let accepted = 0;
    let rejected = 0;
    for (const session of sessions) {
      if (!isValid(session) || !isConsenting(session, cfg)) {
        rejected += 1;
        continue;
      }
      try {
        // Scrub BEFORE store — the raw session is never persisted.
        const scrubbed = scrubber.scrub(session);
        await store.put(scrubbed);
        accepted += 1;
      } catch {
        rejected += 1;
      }
    }
    return { status: 202, body: { status: 'accepted', accepted, rejected } };
  };
}
