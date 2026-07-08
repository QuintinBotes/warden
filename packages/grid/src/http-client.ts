import { WardenError } from '@warden/core';

/**
 * The minimal HTTP seam the cloud grid adapters drive. Real implementations live behind
 * {@link createGridProvider}; unit tests inject a fake that records request payloads, so no
 * adapter ever touches the network in a test.
 */
export interface GridHttpClient {
  /** POST a JSON body and parse the JSON response. */
  postJson<T = unknown>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  /** GET and parse the JSON response. */
  getJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T>;
  /** Build a driving handle for a provisioned grid endpoint (Playwright connect / WebDriver). */
  connect(endpoint: string): GridConnection;
}

/** A resolved driving handle for one provisioned lane. */
export interface GridConnection {
  /** The endpoint the runner connects to (Playwright connect URL or WebDriver hub URL). */
  endpoint: string;
}

/**
 * A lane could not be provisioned because the provider was at capacity (queue full) even after
 * bounded retries. The CI wiring records this as a `ShardPlan.skippedLanes` entry — a lane is
 * never silently dropped. `reason` is ready to copy straight into the skipped-lane summary.
 */
export class GridCapacityError extends WardenError {
  readonly reason: string;
  constructor(reason: string) {
    super(reason, 'E_GRID_CAPACITY');
    this.name = 'GridCapacityError';
    this.reason = reason;
  }
}

/**
 * The default `fetch`-backed {@link GridHttpClient}. NOT unit-tested (it performs real network
 * I/O); every adapter test injects a fake instead. Supplied by {@link createGridProvider} when the
 * caller does not inject its own client.
 */
export function defaultGridHttpClient(): GridHttpClient {
  return {
    async postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(headers ?? {}) },
        body: JSON.stringify(body),
      });
      return (await res.json()) as T;
    },
    async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
      const res = await fetch(url, { method: 'GET', headers: { ...(headers ?? {}) } });
      return (await res.json()) as T;
    },
    connect(endpoint: string): GridConnection {
      return { endpoint };
    },
  };
}
