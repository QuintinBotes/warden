import { WardenError, type GateDecision, type QAPlatformPlugin, type Severity } from '@warden/core';
import type { FetchLike } from './fetch-like.js';
import { slackPlugin } from './slack-plugin.js';
import { teamsPlugin } from './teams-plugin.js';
import { webhookPlugin } from './webhook-plugin.js';
import { pagerdutyPlugin } from './pagerduty-plugin.js';

/** One chat/webhook channel's config — `cfg.notifications.slack` / `.teams` / `.webhook`. */
export interface NotificationChannelConfig {
  enabled: boolean;
  notifyOn?: GateDecision['decision'][];
  bugSeverity?: Severity[];
}

/** PagerDuty's config — `pageOn` (not `notifyOn`), deliberately narrower by default. */
export interface PagerdutyChannelConfig {
  enabled: boolean;
  pageOn?: GateDecision['decision'][];
  bugSeverity?: Severity[];
}

/**
 * The `notifications` block this package expects on the caller's config. Not part of
 * `@warden/core`'s `WardenConfigSchema` in this revision — callers that want config-file-driven
 * notifications pass this shape (e.g. `cfg.notifications` from their own config extension)
 * straight through to `createNotificationPlugins`.
 */
export interface NotificationsConfig {
  slack?: NotificationChannelConfig;
  teams?: NotificationChannelConfig;
  webhook?: NotificationChannelConfig;
  pagerduty?: PagerdutyChannelConfig;
  /** e.g. `"https://qa.example.com"` — enables replay links once set. */
  dashboardBaseUrl?: string;
}

/**
 * Secrets follow the `@warden/integrations` convention (`CreateIntegrationDeps.token`): they
 * are never config values, only injected deps the CLI/Action populate from env vars.
 */
export interface CreateNotificationPluginsDeps {
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** env: `WARDEN_SLACK_WEBHOOK_URL` */
  slackWebhookUrl?: string;
  /** env: `WARDEN_TEAMS_WEBHOOK_URL` */
  teamsWebhookUrl?: string;
  /** env: `WARDEN_WEBHOOK_URL` */
  webhookUrl?: string;
  /** env: `WARDEN_WEBHOOK_SECRET` — HMAC-signs the payload when set. */
  webhookSecret?: string;
  /** env: `WARDEN_PAGERDUTY_ROUTING_KEY` */
  pagerdutyRoutingKey?: string;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Selects and constructs the enabled channels from `cfg.notifications`, same factory pattern as
 * `createIntegration`/`createReporters`. Throws a `WardenError('NOTIFICATION_MISSING_CONFIG')`
 * if a channel is `enabled` but its required secret/URL is missing — fail-fast, before any test
 * runs, matching `createIntegration`'s missing-token behavior.
 *
 * Returns a **fresh** array of plugin instances on every call — never share the result across
 * concurrent pipeline runs (see `notification-plugin.ts`'s docstring).
 */
export function createNotificationPlugins(
  cfg: NotificationsConfig,
  deps: CreateNotificationPluginsDeps = {},
): QAPlatformPlugin[] {
  const plugins: QAPlatformPlugin[] = [];

  if (cfg.slack?.enabled) {
    if (!deps.slackWebhookUrl) {
      throw new WardenError(
        'deps.slackWebhookUrl is required when cfg.notifications.slack.enabled is true',
        'NOTIFICATION_MISSING_CONFIG',
      );
    }
    plugins.push(
      slackPlugin({
        webhookUrl: deps.slackWebhookUrl,
        notifyOn: cfg.slack.notifyOn,
        bugSeverity: cfg.slack.bugSeverity,
        dashboardBaseUrl: cfg.dashboardBaseUrl,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      }),
    );
  }

  if (cfg.teams?.enabled) {
    if (!deps.teamsWebhookUrl) {
      throw new WardenError(
        'deps.teamsWebhookUrl is required when cfg.notifications.teams.enabled is true',
        'NOTIFICATION_MISSING_CONFIG',
      );
    }
    plugins.push(
      teamsPlugin({
        webhookUrl: deps.teamsWebhookUrl,
        notifyOn: cfg.teams.notifyOn,
        bugSeverity: cfg.teams.bugSeverity,
        dashboardBaseUrl: cfg.dashboardBaseUrl,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      }),
    );
  }

  if (cfg.webhook?.enabled) {
    if (!deps.webhookUrl) {
      throw new WardenError(
        'deps.webhookUrl is required when cfg.notifications.webhook.enabled is true',
        'NOTIFICATION_MISSING_CONFIG',
      );
    }
    plugins.push(
      webhookPlugin({
        url: deps.webhookUrl,
        secret: deps.webhookSecret,
        notifyOn: cfg.webhook.notifyOn,
        bugSeverity: cfg.webhook.bugSeverity,
        dashboardBaseUrl: cfg.dashboardBaseUrl,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      }),
    );
  }

  if (cfg.pagerduty?.enabled) {
    if (!deps.pagerdutyRoutingKey) {
      throw new WardenError(
        'deps.pagerdutyRoutingKey is required when cfg.notifications.pagerduty.enabled is true',
        'NOTIFICATION_MISSING_CONFIG',
      );
    }
    plugins.push(
      pagerdutyPlugin({
        routingKey: deps.pagerdutyRoutingKey,
        pageOn: cfg.pagerduty.pageOn,
        bugSeverity: cfg.pagerduty.bugSeverity,
        dashboardBaseUrl: cfg.dashboardBaseUrl,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
      }),
    );
  }

  return plugins;
}
