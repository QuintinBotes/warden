import type { GateDecision, QAPlatformPlugin, Severity } from '@warden/core';
import type { FetchLike } from './fetch-like.js';
import { createPagerdutySender } from './channels/pagerduty-sender.js';
import { createNotificationPlugin } from './notification-plugin.js';

export interface PagerdutyPluginOptions {
  /** A PagerDuty Events API v2 integration routing key. Env: `WARDEN_PAGERDUTY_ROUTING_KEY`. */
  routingKey: string;
  /**
   * `GateDecision.decision` values that page on-call. Default: `['BLOCK']` only — deliberately
   * narrower than Slack/Teams' `notifyOn`, to avoid on-call alert fatigue from a chat-oriented
   * signal (paging is expensive).
   */
  pageOn?: GateDecision['decision'][];
  /** `ExploratoryFinding.severity` values that page on-call. Default: `['CRITICAL']` only. */
  bugSeverity?: Severity[];
  /** Enables a "Replay in dashboard" link once an execution id is cached. */
  dashboardBaseUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Overrides the Events API endpoint — for tests or region-specific deployments. */
  eventsUrl?: string;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Builds a fresh `QAPlatformPlugin` that triggers a PagerDuty incident on `BLOCK` gate
 * decisions and `CRITICAL` bugs (by default — both filters are configurable). The sender
 * derives `dedup_key` from `${pr.number}:${event}` so re-runs of the same PR update one
 * incident instead of paging twice. Never share the returned plugin across concurrent runs.
 */
export function pagerdutyPlugin(opts: PagerdutyPluginOptions): QAPlatformPlugin {
  const sender = createPagerdutySender({
    routingKey: opts.routingKey,
    fetchImpl: opts.fetchImpl,
    eventsUrl: opts.eventsUrl,
  });
  return createNotificationPlugin('pagerduty', sender, {
    notifyOn: opts.pageOn ?? ['BLOCK'],
    bugSeverity: opts.bugSeverity ?? ['CRITICAL'],
    dashboardBaseUrl: opts.dashboardBaseUrl,
    now: opts.now,
  });
}
