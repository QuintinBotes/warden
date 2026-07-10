/**
 * Parsers for the two shapes the Warden CLI hands back over stdout:
 *  - `warden analyze` → GitHub-Actions `key=value` output lines.
 *  - `warden report aggregate` → a JSON gate report.
 *
 * Both are intentionally lenient: the CLI is a separately-built work-stream, so
 * we tolerate surrounding log noise rather than couple to its exact framing.
 */
import { WardenError } from '@warden/core';
import type { ExploratoryFinding } from '@warden/core';
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

/** A failing test the aggregate step maps back to a file + line for annotations. */
export interface AggregateFailure {
  path: string;
  line?: number;
  message: string;
  title?: string;
  priority?: 'P1' | 'P2' | 'P3';
  annotation_level?: CheckAnnotation['annotation_level'];
}

/** Roll-up counts for the report header. */
export interface AggregateSummary {
  total: number;
  passed: number;
  failed: number;
}

/** The gate report the action consumes from `warden report aggregate`. */
export interface AggregateReport {
  gate: { decision: GateVerdict; reason: string };
  reportPath?: string;
  riskScore?: number;
  summary?: AggregateSummary;
  failures?: AggregateFailure[];
  findings?: ExploratoryFinding[];
  /** Optional pre-rendered Markdown; when absent the action renders its own. */
  markdown?: string;
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
      'Warden: could not find a JSON gate report in `warden report aggregate` output.',
      'AGGREGATE_PARSE_ERROR',
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new WardenError(
      'Warden: `warden report aggregate` did not return valid JSON.',
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
