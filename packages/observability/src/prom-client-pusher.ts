import { Gauge, Pushgateway, Registry } from 'prom-client';
import type { MetricsPusher, PushedMetric } from './types.js';

/**
 * Default, production `MetricsPusher` backed by `prom-client`'s `Pushgateway` client. Builds a
 * fresh `Registry` per push containing exactly the metrics being pushed, then PUTs them to the
 * pushgateway under `job`. Never touched by unit tests — those inject a fake `MetricsPusher`
 * instead — so no real network call happens in the test suite.
 */
export class PromClientPusher implements MetricsPusher {
  constructor(private readonly url: string) {}

  async push(job: string, metrics: PushedMetric[]): Promise<void> {
    const registry = new Registry();

    for (const metric of metrics) {
      const gauge = new Gauge({
        name: metric.name,
        help: metric.help,
        labelNames: Object.keys(metric.labels),
        registers: [registry],
      });
      gauge.set(metric.labels, metric.value);
    }

    const gateway = new Pushgateway(this.url, undefined, registry);
    await gateway.pushAdd({ jobName: job });
  }
}
