import type { OctokitLike, OctokitResponse } from './octokit-file-access.js';

/** One recorded octokit request: the route template + the params it was called with. */
export interface RecordedRequest {
  route: string;
  params: Record<string, unknown>;
}

/** A recording {@link OctokitLike} fake: it captures every request for assertions. */
export interface FakeOctokit extends OctokitLike {
  calls: RecordedRequest[];
}

/** An octokit-shaped error carrying an HTTP `status` (so `errorStatus` can read it). */
export function httpError(status: number, message = 'error'): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * Build a recording fake octokit driven by a single `handler(route, params)`.
 * The handler returns `{ status?, data? }` or throws (e.g. {@link httpError}(404))
 * to simulate an error response. No real network is ever touched.
 */
export function fakeOctokit(
  handler: (
    route: string,
    params: Record<string, unknown>,
  ) => { status?: number; data?: unknown } | undefined,
): FakeOctokit {
  const calls: RecordedRequest[] = [];
  return {
    calls,
    async request(route: string, params: Record<string, unknown> = {}): Promise<OctokitResponse> {
      calls.push({ route, params });
      const result = handler(route, params);
      return { status: result?.status ?? 200, data: result?.data };
    },
  };
}
