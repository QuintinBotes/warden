/**
 * `@warden/notifications` — first-party `QAPlatformPlugin`s that turn a `GateDecision` or
 * `ExploratoryFinding` into a compact, linkable message posted to Slack, Teams, PagerDuty, or
 * a generic webhook. No network or GitHub calls of its own — every collaborator (the HTTP call,
 * the clock) is injected, so the whole package is unit-testable without a live endpoint.
 *
 * See `docs/proposals/2026-07-08-notifications.md` for the full design.
 */
export type {
  NotificationContext,
  NotificationMessage,
  NotificationSeverity,
} from './message-builder.js';
export { buildBugMessage, buildGateMessage } from './message-builder.js';

export type { ChannelSender } from './channel-sender.js';

export type { NotificationPluginOptions } from './notification-plugin.js';
export { createNotificationPlugin } from './notification-plugin.js';

export type { FetchLike, FetchResponseLike } from './fetch-like.js';
export { defaultFetch, postJson } from './fetch-like.js';

export type { SlackSenderOptions } from './channels/slack-sender.js';
export { createSlackSender } from './channels/slack-sender.js';
export type { TeamsSenderOptions } from './channels/teams-sender.js';
export { createTeamsSender } from './channels/teams-sender.js';
export type { WebhookSenderOptions } from './channels/webhook-sender.js';
export { createWebhookSender } from './channels/webhook-sender.js';
export type { PagerdutySenderOptions } from './channels/pagerduty-sender.js';
export { createPagerdutySender } from './channels/pagerduty-sender.js';

export type { SlackPluginOptions } from './slack-plugin.js';
export { slackPlugin } from './slack-plugin.js';
export type { TeamsPluginOptions } from './teams-plugin.js';
export { teamsPlugin } from './teams-plugin.js';
export type { WebhookPluginOptions } from './webhook-plugin.js';
export { webhookPlugin } from './webhook-plugin.js';
export type { PagerdutyPluginOptions } from './pagerduty-plugin.js';
export { pagerdutyPlugin } from './pagerduty-plugin.js';

export type {
  CreateNotificationPluginsDeps,
  NotificationChannelConfig,
  NotificationsConfig,
  PagerdutyChannelConfig,
} from './create-notification-plugins.js';
export { createNotificationPlugins } from './create-notification-plugins.js';
