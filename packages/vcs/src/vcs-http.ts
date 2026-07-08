import { WardenError } from '@warden/core';

/**
 * Injected `fetch` — every adapter is built on this so no `VcsProvider` ever makes a real
 * network call in a unit test. Defaults to the global `fetch` only when the caller (CLI)
 * doesn't inject one.
 */
export type FetchImpl = typeof fetch;

/** The raw, host-agnostic result of one HTTP call: status + already-read body text. */
export interface RawResponse {
  ok: boolean;
  status: number;
  text: string;
}

/** Arguments for one HTTP call. `body` is already-serialized (JSON string, form string, …). */
export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Performs one HTTP call over the injected `fetch`, reading the body as text (JSON is parsed
 * by the caller). Never throws on a non-2xx — returns the status so callers can tolerate a
 * 404 (a missing branch/file/PR is a normal control-flow signal, not an error).
 */
export async function rawRequest(fetchImpl: FetchImpl, req: HttpRequest): Promise<RawResponse> {
  const res = await fetchImpl(req.url, {
    method: req.method,
    headers: req.headers,
    ...(req.body !== undefined ? { body: req.body } : {}),
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

/** Parses a `RawResponse` body as JSON, returning `{}` for an empty body. */
export function parseJson<T>(res: RawResponse): T {
  const text = res.text.trim();
  return (text === '' ? {} : JSON.parse(text)) as T;
}

/**
 * Wraps a non-2xx response in a `WardenError` carrying method/URL/status — never the token
 * (only `headers` carry it, and they are never included in the message).
 */
export function requestFailed(res: RawResponse, req: HttpRequest, errorCode: string): WardenError {
  return new WardenError(
    `VCS request failed: ${req.method} ${req.url} -> ${res.status} ${res.text}`,
    errorCode,
  );
}

/** Performs a call and throws {@link requestFailed} on non-2xx; returns the parsed JSON body. */
export async function requestJson<T>(
  fetchImpl: FetchImpl,
  req: HttpRequest,
  errorCode: string,
): Promise<T> {
  const res = await rawRequest(fetchImpl, req);
  if (!res.ok) throw requestFailed(res, req, errorCode);
  return parseJson<T>(res);
}

/** Performs a call and throws on non-2xx, discarding the (unused) body. */
export async function requestVoid(
  fetchImpl: FetchImpl,
  req: HttpRequest,
  errorCode: string,
): Promise<void> {
  const res = await rawRequest(fetchImpl, req);
  if (!res.ok) throw requestFailed(res, req, errorCode);
}

/**
 * Like {@link requestJson}, but returns `null` on a 404 — a missing branch/file/PR is a
 * normal control-flow signal in the idempotent `openDraftPr` flows, not an error.
 */
export async function requestJsonOrNull<T>(
  fetchImpl: FetchImpl,
  req: HttpRequest,
  errorCode: string,
): Promise<T | null> {
  const res = await rawRequest(fetchImpl, req);
  if (res.status === 404) return null;
  if (!res.ok) throw requestFailed(res, req, errorCode);
  return parseJson<T>(res);
}
