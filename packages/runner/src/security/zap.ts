import { spawn } from 'node:child_process';
import {
  BrowserError,
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type GateDecision,
} from '@warden/core';

/**
 * OWASP ZAP glue. The pure converter {@link zapJsonToCtrf} (ZAP JSON → CTRF) and the pure gate
 * helper {@link evaluateZapGate} are unit-tested; {@link runZapBaseline}, which shells out to the
 * ZAP baseline scanner, is integration-only and not unit-tested.
 */

/** Severity buckets derived from ZAP's numeric `riskcode` (0..3). */
export type ZapSeverity = 'informational' | 'low' | 'medium' | 'high';

/** A single ZAP alert as it appears under `site[].alerts[]` in ZAP's JSON report. */
export interface ZapAlert {
  alert?: string;
  name?: string;
  /** `'0'`=Informational, `'1'`=Low, `'2'`=Medium, `'3'`=High. */
  riskcode?: string | number;
  riskdesc?: string;
  desc?: string;
  cweid?: string | number;
  wascid?: string | number;
  /** Tag map (newer ZAP); keys like `OWASP_2021_A03` carry the OWASP category. */
  tags?: Record<string, string>;
  instances?: unknown[];
}

/** A scanned site block in ZAP's JSON report. */
export interface ZapSite {
  '@name'?: string;
  alerts?: ZapAlert[];
}

/** The subset of ZAP's JSON report that Warden consumes. */
export interface ZapReport {
  '@version'?: string;
  site?: ZapSite[];
}

function severityForRiskcode(riskcode: string | number | undefined): ZapSeverity {
  switch (String(riskcode)) {
    case '3':
      return 'high';
    case '2':
      return 'medium';
    case '1':
      return 'low';
    default:
      return 'informational';
  }
}

/** Extract the OWASP category from a ZAP alert's tag map, or `'uncategorized'` if absent. */
function owaspCategory(alert: ZapAlert): string {
  for (const key of Object.keys(alert.tags ?? {})) {
    if (/owasp/i.test(key)) return key;
  }
  return 'uncategorized';
}

/**
 * Pure converter from a ZAP JSON report to a {@link CTRFReport}. Each alert (across every scanned
 * site) becomes one CTRF test: risky alerts (Low/Medium/High) are `failed`, informational ones are
 * `other`. Each test is tagged with its severity and OWASP category, and carries `severity`,
 * `owaspCategory`, `cweid`, and `instances` in `extra`. Output is validated with
 * {@link CTRFReportSchema}.
 */
export function zapJsonToCtrf(json: unknown): CTRFReport {
  const report = (json ?? {}) as ZapReport;
  const tests: CTRFTest[] = [];

  for (const site of report.site ?? []) {
    for (const alert of site.alerts ?? []) {
      const severity = severityForRiskcode(alert.riskcode);
      const category = owaspCategory(alert);
      const name = alert.alert ?? alert.name ?? 'unnamed alert';
      const test: CTRFTest = {
        name,
        status: severity === 'informational' ? 'other' : 'failed',
        duration: 0,
        tags: [severity, category],
        extra: {
          severity,
          owaspCategory: category,
          cweid: alert.cweid !== undefined ? String(alert.cweid) : undefined,
          site: site['@name'],
          instances: (alert.instances ?? []).length,
        },
      };
      const message = alert.riskdesc ?? alert.desc;
      if (message) test.message = message;
      tests.push(test);
    }
  }

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'zap', ...(report['@version'] ? { version: report['@version'] } : {}) },
      summary: {
        tests: tests.length,
        passed: 0,
        failed: tests.filter((t) => t.status === 'failed').length,
        skipped: 0,
        pending: 0,
        other: tests.filter((t) => t.status === 'other').length,
        start: 0,
        stop: 0,
      },
      tests,
    },
  });
}

/** Map a single ZAP severity to a gate decision: high→BLOCK, medium→WARN, else→PASS. */
export function zapSeverityToGate(severity: ZapSeverity): GateDecision {
  switch (severity) {
    case 'high':
      return { decision: 'BLOCK', reason: 'ZAP reported a high-severity alert' };
    case 'medium':
      return { decision: 'WARN', reason: 'ZAP reported a medium-severity alert' };
    default:
      return { decision: 'PASS', reason: 'no ZAP alerts above low severity' };
  }
}

/**
 * Pure gate mapping for a ZAP report (the CTRF output of {@link zapJsonToCtrf}). Any high-severity
 * finding → `BLOCK`, any medium → `WARN`, otherwise `PASS`. Reads `extra.severity` from each test.
 */
export function evaluateZapGate(report: CTRFReport): GateDecision {
  const severities = report.results.tests.map(
    (t) => (t.extra?.severity as ZapSeverity | undefined) ?? 'informational',
  );
  const highs = severities.filter((s) => s === 'high').length;
  const mediums = severities.filter((s) => s === 'medium').length;

  if (highs > 0) {
    return {
      decision: 'BLOCK',
      reason: `ZAP reported ${highs} high-severity alert(s)`,
    };
  }
  if (mediums > 0) {
    return {
      decision: 'WARN',
      reason: `ZAP reported ${mediums} medium-severity alert(s)`,
    };
  }
  return { decision: 'PASS', reason: 'no ZAP alerts above low severity' };
}

/** Options for {@link runZapBaseline}. */
export interface RunZapOptions {
  /** Working directory to run the scanner in. Defaults to the current process cwd. */
  cwd?: string;
  /** Path the scanner writes its JSON report to (relative to `cwd`). Defaults to `zap-report.json`. */
  reportPath?: string;
  /** Override the scanner command (defaults to `zap-baseline.py`). */
  command?: string;
  /** Extra environment variables for the child process. */
  env?: Record<string, string>;
}

/** Result of a {@link runZapBaseline} scan: the CTRF report and the gate decision. */
export interface RunZapResult {
  report: CTRFReport;
  gate: GateDecision;
}

/**
 * Integration glue that shells out to the ZAP baseline scanner. NOT unit-tested (it launches a
 * real scanner against a live URL). Runs `zap-baseline.py -t <url> -J <report>`, reads the JSON
 * report, converts it via {@link zapJsonToCtrf}, and evaluates the gate via {@link evaluateZapGate}.
 */
export function runZapBaseline(url: string, opts: RunZapOptions = {}): Promise<RunZapResult> {
  const command = opts.command ?? 'zap-baseline.py';
  const reportPath = opts.reportPath ?? 'zap-report.json';
  const args = ['-t', url, '-J', reportPath];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    // The baseline scanner exits non-zero when it finds alerts but still writes the JSON report,
    // so we resolve on close regardless of exit code and fail only if reading the report fails.
    child.on('close', () => {
      resolve();
      void stderr;
    });
  }).then(async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve: resolvePath } = await import('node:path');
    const abs = resolvePath(opts.cwd ?? process.cwd(), reportPath);
    let json: unknown;
    try {
      json = JSON.parse(await readFile(abs, 'utf8'));
    } catch (err) {
      throw new BrowserError(`failed to read ZAP JSON report: ${(err as Error).message}`);
    }
    const report = zapJsonToCtrf(json);
    return { report, gate: evaluateZapGate(report) };
  });
}
