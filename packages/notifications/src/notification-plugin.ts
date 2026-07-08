import type {
  GateDecision,
  PullRequest,
  QAPlatformPlugin,
  Severity,
  TestExecution,
  TestResult,
} from '@warden/core';
import type { ChannelSender } from './channel-sender.js';
import { buildBugMessage, buildGateMessage, type NotificationContext } from './message-builder.js';

/** Worst-N `FAIL`/`FLAKY` results cached from `onTestExecutionComplete`. */
const MAX_CACHED_FAILURES = 10;

/**
 * Filters + cached-link config shared by every channel's plugin wrapper.
 * `notifyOn`/`bugSeverity` gate whether a `send` happens at all for a given hook.
 */
export interface NotificationPluginOptions {
  /** `GateDecision.decision` values that fire a `send` on `onGateDecision`. Default: all. */
  notifyOn?: GateDecision['decision'][];
  /** `ExploratoryFinding.severity` values that fire a `send` on `onBugFound`. Default: all. */
  bugSeverity?: Severity[];
  /** `cfg.notifications.dashboardBaseUrl` — enables a replay link once an execution id is cached. */
  dashboardBaseUrl?: string;
  /** Injected clock for deterministic tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

const ALL_DECISIONS: GateDecision['decision'][] = ['PASS', 'WARN', 'BLOCK'];
const ALL_SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/**
 * The one stateful wrapper every first-party channel (`slackPlugin`, `teamsPlugin`,
 * `webhookPlugin`, `pagerdutyPlugin`) reuses: caches `PullRequest` + the execution's worst
 * failures across `onPROpened` / `onTestExecutionComplete`, filters by severity/verdict, and
 * calls `sender.send` (composed from the cached context + that hook's own payload) on
 * `onBugFound` / `onGateDecision`.
 *
 * Returns a **fresh** plugin instance — never share one `QAPlatformPlugin` returned by this
 * function across concurrent pipeline runs; its cached PR/execution context is scoped to a
 * single run's `onPROpened` → `onTestExecutionComplete` → `onBugFound`/`onGateDecision` order.
 */
export function createNotificationPlugin(
  name: string,
  sender: ChannelSender,
  options: NotificationPluginOptions = {},
): QAPlatformPlugin {
  const notifyOn = options.notifyOn ?? ALL_DECISIONS;
  const bugSeverity = options.bugSeverity ?? ALL_SEVERITIES;
  const now = options.now ?? (() => new Date());

  let pr: PullRequest | undefined;
  let executionId: string | undefined;
  let topFailures: { testCaseId: string; errorMessage?: string }[] | undefined;

  function context(): NotificationContext {
    const dashboardExecutionUrl =
      options.dashboardBaseUrl !== undefined && executionId !== undefined
        ? `${options.dashboardBaseUrl}/executions/${executionId}`
        : undefined;

    return {
      ...(pr !== undefined && { pr }),
      ...(topFailures !== undefined && { topFailures }),
      ...(dashboardExecutionUrl !== undefined && { dashboardExecutionUrl }),
    };
  }

  return {
    name,

    async onPROpened(openedPr: PullRequest) {
      pr = openedPr;
    },

    async onTestExecutionComplete(execution: TestExecution, results: TestResult[]) {
      executionId = execution.id;
      topFailures = results
        .filter((r) => r.status === 'FAIL' || r.status === 'FLAKY')
        .slice(0, MAX_CACHED_FAILURES)
        .map((r) => ({
          testCaseId: r.testCaseId,
          ...(r.errorMessage !== undefined && { errorMessage: r.errorMessage }),
        }));
    },

    async onBugFound(bug) {
      if (!bugSeverity.includes(bug.severity)) return;
      await sender.send(buildBugMessage(bug, context(), now));
    },

    async onGateDecision(decision) {
      if (!notifyOn.includes(decision.decision)) return;
      await sender.send(buildGateMessage(decision, context(), now));
    },
  };
}
