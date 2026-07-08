import type { GateDecision, QAPlatformPlugin, Severity } from '@warden/core';
import type { FetchLike } from './fetch-like.js';
import { createTeamsSender } from './channels/teams-sender.js';
import { createNotificationPlugin } from './notification-plugin.js';

export interface TeamsPluginOptions {
  /** A Teams incoming webhook / Power Automate workflow URL. Env: `WARDEN_TEAMS_WEBHOOK_URL`. */
  webhookUrl: string;
  /** `GateDecision.decision` values that fire a message. Default: `['BLOCK', 'WARN']`. */
  notifyOn?: GateDecision['decision'][];
  /** `ExploratoryFinding.severity` values that fire a message. Default: `['CRITICAL', 'HIGH']`. */
  bugSeverity?: Severity[];
  /** Enables a "Replay in dashboard" action once an execution id is cached. */
  dashboardBaseUrl?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

/**
 * Builds a fresh `QAPlatformPlugin` that posts a Teams Adaptive Card on `BLOCK`/`WARN` gate
 * decisions and on `CRITICAL`/`HIGH` bugs found by the AI-exploratory tier (by default — both
 * filters are configurable). Never share the returned plugin across concurrent pipeline runs.
 */
export function teamsPlugin(opts: TeamsPluginOptions): QAPlatformPlugin {
  const sender = createTeamsSender({ webhookUrl: opts.webhookUrl, fetchImpl: opts.fetchImpl });
  return createNotificationPlugin('teams', sender, {
    notifyOn: opts.notifyOn ?? ['BLOCK', 'WARN'],
    bugSeverity: opts.bugSeverity ?? ['CRITICAL', 'HIGH'],
    dashboardBaseUrl: opts.dashboardBaseUrl,
    now: opts.now,
  });
}
