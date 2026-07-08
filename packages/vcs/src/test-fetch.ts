import type { FetchImpl } from './vcs-http.js';

/** One HTTP call recorded by {@link routerFetch}, for request-shape assertions. */
export interface RecordedCall {
  method: string;
  url: string;
  raw?: string;
  body: unknown; // JSON-parsed body when the raw body was JSON
  headers: Record<string, string>;
}

/** What a route handler returns for one call. `body` is JSON-stringified unless `text` is set. */
export interface StubResponse {
  status?: number;
  body?: unknown;
  text?: string;
}

export type RouteHandler = (call: {
  method: string;
  url: string;
  body: unknown;
  raw?: string;
}) => StubResponse;

/**
 * An in-memory, injectable `fetch` that routes each call through `handler` and records every
 * request for assertions — the single hermetic seam every adapter test is built on.
 */
export function routerFetch(handler: RouteHandler): {
  fetchImpl: FetchImpl;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const raw = init?.body as string | undefined;
    let body: unknown;
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    calls.push({
      method,
      url: String(url),
      ...(raw !== undefined ? { raw } : {}),
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const res = handler({ method, url: String(url), body, ...(raw !== undefined ? { raw } : {}) });
    const status = res.status ?? 200;
    const text = res.text ?? (res.body !== undefined ? JSON.stringify(res.body) : '');
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return text;
      },
      async json() {
        return text ? JSON.parse(text) : {};
      },
    };
  }) as unknown as FetchImpl;
  return { fetchImpl, calls };
}
