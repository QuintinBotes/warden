import {
  BrowserError,
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type GateDecision,
} from '@warden/core';

/**
 * axe-core accessibility glue. Shaped exactly like `perf/k6.ts` / `security/zap.ts`: the pure
 * converter {@link axeResultsToCtrf} (axe results → CTRF) and the pure gate helper
 * {@link evaluateA11yGate} are unit-tested; {@link runAxeAudit}, which drives a real Chromium via
 * Playwright, is integration-only and not unit-tested.
 */

/** A single axe-core violation node (one offending DOM element). */
export interface AxeNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

/** One axe-core rule violation, as returned by `axe.run()`. */
export interface AxeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}

/** The subset of `axe.run()`'s result Warden consumes, for one audited route. */
export interface AxeRouteResult {
  route: string;
  violations: AxeViolation[];
}

/** Injected impact→gate mapping, from `cfg.a11y`. */
export interface A11yGateConfig {
  blockOnImpact: AxeViolation['impact'][];
  warnOnImpact: AxeViolation['impact'][];
}

function countStatus(tests: CTRFTest[], status: CTRFTest['status']): number {
  return tests.filter((t) => t.status === status).length;
}

/**
 * Pure converter: one CTRF test per (route, violation). `extra` carries `impact`, `route`,
 * `helpUrl`, `wcagTags`, `selectors`, and `nodeCount` so a reviewer sees exactly what and where
 * without re-running the audit. Output is validated with {@link CTRFReportSchema}.
 */
export function axeResultsToCtrf(results: AxeRouteResult[]): CTRFReport {
  const tests: CTRFTest[] = [];

  for (const { route, violations } of results) {
    for (const violation of violations) {
      const selectors = violation.nodes.flatMap((n) => n.target);
      const wcagTags = violation.tags.filter((t) => /^wcag/i.test(t));
      // Every entry in axe-core's `violations[]` is, by definition, a failing rule check — axe
      // separates passes/incomplete/inapplicable results out already, so there is nothing to mark
      // `passed` here.
      const test: CTRFTest = {
        name: `${route}: ${violation.id}`,
        status: 'failed',
        duration: 0,
        message: violation.help,
        tags: [violation.impact ?? 'unknown', ...violation.tags],
        extra: {
          impact: violation.impact,
          route,
          helpUrl: violation.helpUrl,
          wcagTags,
          selectors,
          nodeCount: violation.nodes.length,
        },
      };
      tests.push(test);
    }
  }

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'axe-core' },
      summary: {
        tests: tests.length,
        passed: countStatus(tests, 'passed'),
        failed: countStatus(tests, 'failed'),
        skipped: countStatus(tests, 'skipped'),
        pending: countStatus(tests, 'pending'),
        other: countStatus(tests, 'other'),
        start: 0,
        stop: 0,
      },
      tests,
    },
  });
}

/**
 * Pure gate mapping over the CTRF output of {@link axeResultsToCtrf}: any violation whose
 * `extra.impact` is in `cfg.blockOnImpact` → `BLOCK`, else any in `cfg.warnOnImpact` → `WARN`,
 * else `PASS`.
 */
export function evaluateA11yGate(report: CTRFReport, cfg: A11yGateConfig): GateDecision {
  const impacts = report.results.tests.map(
    (t) => (t.extra?.impact as AxeViolation['impact'] | undefined) ?? null,
  );

  const blocking = impacts.filter((impact) => cfg.blockOnImpact.includes(impact));
  if (blocking.length > 0) {
    return {
      decision: 'BLOCK',
      reason: `axe found ${blocking.length} violation(s) at a blocking impact level (${cfg.blockOnImpact.join(', ')})`,
    };
  }

  const warning = impacts.filter((impact) => cfg.warnOnImpact.includes(impact));
  if (warning.length > 0) {
    return {
      decision: 'WARN',
      reason: `axe found ${warning.length} violation(s) at a warn-only impact level (${cfg.warnOnImpact.join(', ')})`,
    };
  }

  return { decision: 'PASS', reason: 'no axe violations at a configured block/warn impact level' };
}

/** Options for {@link runAxeAudit}. */
export interface RunAxeOptions {
  standard: 'wcag2a' | 'wcag2aa' | 'wcag21aa' | 'wcag22aa';
  ignoreRules: string[];
  baseUrl: string;
  headless?: boolean;
}

/** Result of a {@link runAxeAudit} run: the raw per-route results, the CTRF report, and the gate. */
export interface RunAxeResult {
  results: AxeRouteResult[];
  report: CTRFReport;
  gate: GateDecision;
}

/** The structural subset of axe-core's `axe.run()` result Warden reads from the page context. */
interface RawAxeRunResult {
  violations: AxeViolation[];
}

/** The shape of `window.axe.run` once the bundled axe-core script is injected into the page. */
type AxeRunFn = (
  context: unknown,
  options: { runOnly: string[]; rules: Record<string, { enabled: boolean }> },
) => Promise<RawAxeRunResult>;

// `page.evaluate()`'s callback below is serialized and executed inside the browser page, where
// `window`/`document` are real globals — this package's tsconfig has no `dom` lib, so they are
// declared ambiently, scoped to this module, rather than pulling `dom` into the whole package.
declare const window: { axe: { run: AxeRunFn } };
declare const document: unknown;

/**
 * Integration glue. NOT unit-tested (launches a real Chromium via Playwright). For each route:
 * navigates, injects the bundled `axe-core` script, runs `axe.run({ runOnly: [standard] })`
 * filtered by `ignoreRules`, and closes the page. Converts + gates via the pure functions above.
 */
export async function runAxeAudit(
  routes: string[],
  cfg: A11yGateConfig,
  opts: RunAxeOptions,
): Promise<RunAxeResult> {
  const { chromium } = await import('playwright');
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');

  const require = createRequire(import.meta.url);
  const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8');

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext({ baseURL: opts.baseUrl });
  const results: AxeRouteResult[] = [];

  try {
    for (const route of routes) {
      const page = await context.newPage();
      try {
        await page.goto(route);
        await page.addScriptTag({ content: axeSource });
        const raw = await page.evaluate(
          ({ standard, ignoreRules }: { standard: string; ignoreRules: string[] }) => {
            const rules = Object.fromEntries(ignoreRules.map((id) => [id, { enabled: false }]));
            return window.axe.run(document, { runOnly: [standard], rules });
          },
          { standard: opts.standard, ignoreRules: opts.ignoreRules },
        );
        results.push({ route, violations: raw.violations });
      } finally {
        await page.close();
      }
    }
  } catch (err) {
    throw new BrowserError(`axe audit failed: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }

  const report = axeResultsToCtrf(results);
  return { results, report, gate: evaluateA11yGate(report, cfg) };
}
