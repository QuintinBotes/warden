/**
 * A single Prometheus-shaped metric ready to push. Kept provider-agnostic (no `prom-client`
 * types leak out of this module) so a fake pusher in tests can assert on plain data.
 */
export interface PushedMetric {
  /** Prometheus metric name, e.g. `warden_test_pass_rate`. */
  name: string;
  /** HELP text shown alongside the metric. */
  help: string;
  /** Prometheus metric type. Every metric this package emits is a point-in-time gauge. */
  type: 'gauge';
  /** The metric's current value. */
  value: number;
  /** Label name/value pairs attached to the metric. */
  labels: Record<string, string>;
}

/**
 * Minimal seam over a Prometheus Pushgateway client. Unit tests inject a fake that records
 * calls instead of touching the network; `PromClientPusher` is the real, `prom-client`-backed
 * implementation used in production.
 */
export interface MetricsPusher {
  push(job: string, metrics: PushedMetric[]): Promise<void>;
}
