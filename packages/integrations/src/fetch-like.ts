import { WardenError } from '@warden/core';

/**
 * Minimal shape of a `fetch` Response this package needs. Adapters accept anything
 * structurally compatible with the platform's global `fetch`, so unit tests can inject a
 * plain fake instead of ever touching a real network.
 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Minimal shape of `fetch` this package calls into — injected so no live network in tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

/** The default `fetchImpl` for adapters when the caller doesn't inject one. */
export function defaultFetch(): FetchLike {
  return globalThis.fetch as unknown as FetchLike;
}

/** POSTs/PATCHes/GETs `url`, parses the JSON body, and throws a typed error on non-2xx. */
export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit | undefined,
  errorCode: string,
): Promise<unknown> {
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    throw new WardenError(`request to ${url} failed with status ${res.status}`, errorCode);
  }
  return res.json();
}
