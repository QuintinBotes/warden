/**
 * Parsers for the two shapes the Warden CLI hands back over stdout:
 *  - `warden analyze` → GitHub-Actions `key=value` output lines.
 *  - `warden report aggregate --json` → a JSON `GateReport`. (Without `--json` that command
 *    prints a one-line human summary with no JSON in it at all, which is not parseable here —
 *    see `warden-cli.ts`.)
 *
 * Both are intentionally lenient about framing: the CLI is a separately-built
 * work-stream, so we tolerate surrounding log noise. What is *not* lenient is the
 * shape — `GateReport` is defined once in `@warden/core` and imported by both the
 * CLI that writes it and this parser, so the two cannot drift apart again.
 */
import { WardenError } from '@warden/core';
import type {
  ExploratoryFinding,
  GateReport,
  GateReportFailure,
  GateReportSummary,
} from '@warden/core';
import type { CheckAnnotation, GateVerdict } from './types.js';

/** Parse `key=value` lines (the GitHub-Actions `$GITHUB_OUTPUT` format). */
export function parseGithubOutput(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/**
 * A failing test the aggregate step maps back to a file + line for annotations.
 *
 * The shared `GateReportFailure` plus the two hints only a CI host uses; the CLI does not
 * classify priority, so both stay optional and `buildAnnotations` derives a level without them.
 */
export interface AggregateFailure extends GateReportFailure {
  priority?: 'P1' | 'P2' | 'P3';
  annotation_level?: CheckAnnotation['annotation_level'];
}

/** Roll-up counts for the report header. */
export type AggregateSummary = GateReportSummary;

/**
 * The gate report the action consumes from `warden report aggregate --json`: the shared
 * `GateReport` contract, plus the fields only this action's own rendering adds.
 */
export interface AggregateReport extends Omit<GateReport, 'failures'> {
  riskScore?: number;
  failures?: AggregateFailure[];
  findings?: ExploratoryFinding[];
}

/**
 * Only an explicit, recognized PASS/WARN/BLOCK is trusted. A missing or unrecognized decision
 * fails **closed** to BLOCK — a gate report we can't read must never read as a green merge signal.
 */
function normalizeGate(raw: unknown, fallbackReason: unknown): AggregateReport['gate'] {
  const isObject = Boolean(raw) && typeof raw === 'object';
  const g = isObject ? (raw as { decision?: unknown; reason?: unknown }) : undefined;
  const rawDecision = g ? g.decision : raw;
  const reason = g
    ? typeof g.reason === 'string'
      ? g.reason
      : ''
    : typeof fallbackReason === 'string'
      ? fallbackReason
      : '';

  const decision = String(rawDecision ?? '').toUpperCase();
  if (decision === 'PASS' || decision === 'WARN' || decision === 'BLOCK') {
    return { decision: decision as GateVerdict, reason };
  }
  return {
    decision: 'BLOCK',
    reason: reason || 'unrecognized or missing gate decision — failing closed',
  };
}

/** Extract and parse the JSON gate report from a (possibly noisy) stdout blob. */
export function parseAggregateReport(stdout: string): AggregateReport {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new WardenError(
      'Warden: `warden report aggregate --json` printed no JSON gate report. Either the ' +
        '`warden` CLI resolved on PATH predates `--json` and is older than this action, or it ' +
        'failed before the gate was computed.',
      'AGGREGATE_PARSE_ERROR',
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new WardenError(
      'Warden: `warden report aggregate --json` did not return valid JSON.',
      'AGGREGATE_PARSE_ERROR',
    );
  }
  return {
    gate: normalizeGate(parsed.gate, parsed.reason),
    reportPath: typeof parsed.reportPath === 'string' ? parsed.reportPath : undefined,
    riskScore: typeof parsed.riskScore === 'number' ? parsed.riskScore : undefined,
    summary: parsed.summary as AggregateSummary | undefined,
    failures: Array.isArray(parsed.failures) ? (parsed.failures as AggregateFailure[]) : undefined,
    findings: Array.isArray(parsed.findings)
      ? (parsed.findings as ExploratoryFinding[])
      : undefined,
    markdown: typeof parsed.markdown === 'string' ? parsed.markdown : undefined,
  };
}
