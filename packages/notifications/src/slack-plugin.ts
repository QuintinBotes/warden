import type { GateDecision, QAPlatformPlugin, Severity } from '@warden/core';
import type { FetchLike } from './fetch-like.js';
import { createSlackSender } from './channels/slack-sender.js';
import { createNotificationPlugin } from './notification-plugin.js';

export interface SlackPluginOptions {
  /** A Slack "Incoming Webhook" URL. Read from `WARDEN_SLACK_WEBHOOK_URL` by convention. */
  webhookUrl: string;
  /** `GateDecision.decision` values that fire a message. Default: `['BLOCK', 'WARN']`. */
  notifyOn?: GateDecision['decision'][];
  /** `ExploratoryFinding.severity` values that fire a message. Default: `['CRITICAL', 'HIGH']`. */
  bugSeverity?: Severity[];
  /** Enables a "Replay in dashboard" link once an execution id is cached. */
  dashboardBaseUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Builds a fresh `QAPlatformPlugin` that posts a compact Slack message on `BLOCK`/`WARN` gate
 * decisions and on `CRITICAL`/`HIGH` bugs found by the AI-exploratory tier (by default — both
 * filters are configurable). Never share the returned plugin across concurrent pipeline runs.
 */
export function slackPlugin(opts: SlackPluginOptions): QAPlatformPlugin {
  const sender = createSlackSender({ webhookUrl: opts.webhookUrl, fetchImpl: opts.fetchImpl });
  return createNotificationPlugin('slack', sender, {
    notifyOn: opts.notifyOn ?? ['BLOCK', 'WARN'],
    bugSeverity: opts.bugSeverity ?? ['CRITICAL', 'HIGH'],
    dashboardBaseUrl: opts.dashboardBaseUrl,
    now: opts.now,
  });
}
