import type { GateDecision, QAPlatformPlugin, Severity } from '@warden/core';
import type { FetchLike } from './fetch-like.js';
import { createWebhookSender } from './channels/webhook-sender.js';
import { createNotificationPlugin } from './notification-plugin.js';

export interface WebhookPluginOptions {
  /** Generic outbound webhook URL (email relay, custom bot, ChatOps). Env: `WARDEN_WEBHOOK_URL`. */
  url: string;
  /** When set, HMAC-SHA256-signs the payload as `X-Warden-Signature`. Env: `WARDEN_WEBHOOK_SECRET`. */
  secret?: string;
  /**
   * `GateDecision.decision` values that fire a message. Default: `['BLOCK', 'WARN', 'PASS']`
   * (broader than Slack/Teams — a webhook is often a ChatOps bot that wants every verdict).
   */
  notifyOn?: GateDecision['decision'][];
  /**
   * `ExploratoryFinding.severity` values that fire a message. Default: every severity.
   */
  bugSeverity?: Severity[];
  /** Enables a `dashboardExecutionUrl` link once an execution id is cached. */
  dashboardBaseUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Builds a fresh `QAPlatformPlugin` that POSTs the plain `NotificationMessage` JSON (optionally
 * HMAC-signed) on every verdict by default and on any bug severity — the broadest of the four
 * first-party channels, matching a ChatOps bot or email relay that wants every event. Never
 * share the returned plugin across concurrent pipeline runs.
 */
export function webhookPlugin(opts: WebhookPluginOptions): QAPlatformPlugin {
  const sender = createWebhookSender({
    url: opts.url,
    secret: opts.secret,
    fetchImpl: opts.fetchImpl,
  });
  return createNotificationPlugin('webhook', sender, {
    notifyOn: opts.notifyOn ?? ['BLOCK', 'WARN', 'PASS'],
    bugSeverity: opts.bugSeverity ?? ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
    dashboardBaseUrl: opts.dashboardBaseUrl,
    now: opts.now,
  });
}
