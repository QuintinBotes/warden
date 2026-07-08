import type { ExploratoryFinding, GateDecision, PullRequest, Severity } from '@warden/core';

/**
 * Context a notification plugin has cached across a single pipeline run — the PR (from
 * `onPROpened`), the worst failing/flaky results (from `onTestExecutionComplete`), and a
 * replay link into the dashboard when one is configured. `buildGateMessage`/`buildBugMessage`
 * are pure functions over this context plus the triggering hook's own payload.
 */
export interface NotificationContext {
  pr?: PullRequest;
  /** Worst N `FAIL`/`FLAKY` results from the cached execution. */
  topFailures?: { testCaseId: string; errorMessage?: string }[];
  /** Built from `cfg.notifications.dashboardBaseUrl` + the execution id, when known. */
  dashboardExecutionUrl?: string;
}

export type NotificationSeverity = 'info' | 'warning' | 'critical';

/** Channel-agnostic shape every `ChannelSender` renders into its own wire format. */
export interface NotificationMessage {
  event: 'gate_decision' | 'bug_found';
  title: string;
  summary: string;
  severity: NotificationSeverity;
  /** Top-N failing test ids / repro steps, capped at {@link MAX_DETAILS} with a trailer. */
  details: string[];
  links: { prUrl?: string; dashboardExecutionUrl?: string };
  at: Date;
  /**
   * Stable identity for this (PR, hook) pairing, e.g. `"482:gate_decision"` — not part of the
   * proposal's minimal wire shape, but needed by the PagerDuty sender's `dedup_key` so re-runs
   * of the same PR update one incident instead of opening duplicates. `undefined` when no PR
   * was cached (e.g. a bug/gate hook fired before `onPROpened`).
   */
  dedupKey?: string;
}

/** Cap on `details` — keeps every channel's payload well under its own size limit. */
const MAX_DETAILS = 5;

function capDetails(items: string[]): string[] {
  if (items.length <= MAX_DETAILS) return items;
  const shown = items.slice(0, MAX_DETAILS);
  const more = items.length - MAX_DETAILS;
  return [...shown, `+${more} more, see the PR`];
}

function linksFor(ctx: NotificationContext): NotificationMessage['links'] {
  return {
    ...(ctx.pr?.url !== undefined && { prUrl: ctx.pr.url }),
    ...(ctx.dashboardExecutionUrl !== undefined && {
      dashboardExecutionUrl: ctx.dashboardExecutionUrl,
    }),
  };
}

function dedupKeyFor(
  ctx: NotificationContext,
  event: NotificationMessage['event'],
): string | undefined {
  return ctx.pr !== undefined ? `${ctx.pr.number}:${event}` : undefined;
}

function severityForDecision(decision: GateDecision['decision']): NotificationSeverity {
  switch (decision) {
    case 'BLOCK':
      return 'critical';
    case 'WARN':
      return 'warning';
    case 'PASS':
      return 'info';
    default: {
      const exhaustiveCheck: never = decision;
      throw new Error(`unknown GateDecision.decision: ${String(exhaustiveCheck)}`);
    }
  }
}

function decisionEmoji(decision: GateDecision['decision']): string {
  switch (decision) {
    case 'BLOCK':
      return '⛔';
    case 'WARN':
      return '⚠️';
    case 'PASS':
      return '✅';
    default: {
      const exhaustiveCheck: never = decision;
      throw new Error(`unknown GateDecision.decision: ${String(exhaustiveCheck)}`);
    }
  }
}

function severityForFinding(severity: Severity): NotificationSeverity {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return 'critical';
    case 'MEDIUM':
      return 'warning';
    case 'LOW':
      return 'info';
    default: {
      const exhaustiveCheck: never = severity;
      throw new Error(`unknown Severity: ${String(exhaustiveCheck)}`);
    }
  }
}

function prSuffix(pr: PullRequest | undefined): string {
  return pr ? `PR #${pr.number}: ${pr.title}` : 'this run';
}

/**
 * Composes the outbound message for a `GateDecision` — the verdict, the cached top failures,
 * the PR link, and (when configured) a replay link into the dashboard.
 */
export function buildGateMessage(
  decision: GateDecision,
  ctx: NotificationContext = {},
  now: () => Date = () => new Date(),
): NotificationMessage {
  const details = capDetails(
    (ctx.topFailures ?? []).map((f) =>
      f.errorMessage ? `${f.testCaseId} — ${f.errorMessage}` : f.testCaseId,
    ),
  );

  return {
    event: 'gate_decision',
    title: `${decisionEmoji(decision.decision)} ${decision.decision} — ${prSuffix(ctx.pr)}`,
    summary: decision.reason,
    severity: severityForDecision(decision.decision),
    details,
    links: linksFor(ctx),
    at: now(),
    dedupKey: dedupKeyFor(ctx, 'gate_decision'),
  };
}

/**
 * Composes the outbound message for an `ExploratoryFinding` — the bug's title/severity, its
 * expected-vs-actual as the one-line summary, its repro steps (capped), and the PR link.
 */
export function buildBugMessage(
  bug: ExploratoryFinding,
  ctx: NotificationContext = {},
  now: () => Date = () => new Date(),
): NotificationMessage {
  const details = capDetails(bug.steps);
  const suffix = ctx.pr ? ` (PR #${ctx.pr.number}: ${ctx.pr.title})` : '';

  return {
    event: 'bug_found',
    title: `🐛 ${bug.severity} — ${bug.title}${suffix}`,
    summary: `expected: ${bug.expected} — actual: ${bug.actual}`,
    severity: severityForFinding(bug.severity),
    details,
    links: linksFor(ctx),
    at: now(),
    dedupKey: dedupKeyFor(ctx, 'bug_found'),
  };
}
