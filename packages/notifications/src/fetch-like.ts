import { WardenError } from '@warden/core';

/**
 * Minimal shape of a `fetch` Response this package needs. Channel senders accept anything
 * structurally compatible with the platform's global `fetch`, so unit tests can inject a
 * plain fake instead of ever touching a real network.
 *
 * Mirrors `@warden/integrations`'s `FetchLike` seam — each package owns its own minimal
 * collaborator type by convention rather than sharing one across package boundaries.
 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Minimal shape of `fetch` this package calls into — injected so no live network in tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

/** The default `fetchImpl` for channel senders when the caller doesn't inject one. */
export function defaultFetch(): FetchLike {
  return globalThis.fetch as unknown as FetchLike;
}

/**
 * POSTs `body` to `url` with `AbortSignal.timeout(5000)` (so a hung endpoint can't hang a CI
 * job) and throws a `WardenError` on a non-2xx response, so a failed delivery surfaces to
 * `firePluginHooks` as `{ ok: false }` rather than looking like a silent success.
 */
export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new WardenError(
      `notification POST to ${url} failed with status ${res.status}`,
      'NOTIFICATION_DELIVERY_FAILED',
    );
  }
}
