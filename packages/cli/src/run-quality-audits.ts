import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChangeSurface, WardenConfig, GateDecision, CTRFReport, Logger } from '@warden/core';
import {
  resolveChangedRoutes,
  runAxeAudit,
  runLighthouseAudit,
  type RunAxeResult,
  type RunLighthouseResult,
  type PerfBudgetConfig,
} from '@warden/runner';

/** Injectable audit runners (defaulted to the real Playwright/Lighthouse ones) so `runRun` and
 *  its tests stay hermetic. */
export type A11yAuditFn = typeof runAxeAudit;
export type PerfAuditFn = typeof runLighthouseAudit;

export interface RunQualityAuditsInput {
  changeSurface: ChangeSurface;
  /** Preview/staging deployment the audits run against. */
  baseUrl: string;
  cfg: WardenConfig;
  artifactsDir: string;
  a11yAudit?: A11yAuditFn;
  perfAudit?: PerfAuditFn;
  writeFile?: (file: string, contents: string) => Promise<void>;
  logger?: Pick<Logger, 'info'>;
}

export interface RunQualityAuditsResult {
  /** The a11y and/or perf gate decisions to fold worst-of into the merge gate (only for tiers
   *  that were enabled AND resolved at least one changed route). */
  gates: GateDecision[];
  /** CTRF reports written to the artifacts dir, keyed by tier. */
  reports: { a11y?: CTRFReport; perf?: CTRFReport };
  /** Paths of the CTRF files written (for logging / aggregation). */
  written: string[];
}

/**
 * Runs the route-scoped accessibility (axe) and performance-budget (Lighthouse) tiers when they
 * are enabled, writing each tier's CTRF to the artifacts dir and returning its own gate decision.
 * A tier that resolves no changed routes is a quiet no-op (no CTRF, no gate) — never a false BLOCK.
 */
export async function runQualityAudits(
  input: RunQualityAuditsInput,
): Promise<RunQualityAuditsResult> {
  const { changeSurface, baseUrl, cfg, artifactsDir } = input;
  const write = input.writeFile ?? fs.writeFile;
  const gates: GateDecision[] = [];
  const reports: RunQualityAuditsResult['reports'] = {};
  const written: string[] = [];

  if (cfg.a11y.enabled) {
    const { routes, skippedCount } = resolveChangedRoutes(
      changeSurface,
      cfg.a11y.routes,
      baseUrl,
      cfg.a11y.maxRoutesPerRun,
    );
    if (routes.length === 0) {
      input.logger?.info('a11y: no changed routes matched a11y.routes; skipping');
    } else {
      if (skippedCount > 0) {
        input.logger?.info(
          `a11y: auditing ${routes.length} route(s); ${skippedCount} over the cap skipped`,
        );
      }
      const audit = input.a11yAudit ?? runAxeAudit;
      const res: RunAxeResult = await audit(
        routes,
        { blockOnImpact: cfg.a11y.blockOnImpact, warnOnImpact: cfg.a11y.warnOnImpact },
        { standard: cfg.a11y.standard, ignoreRules: cfg.a11y.ignoreRules, baseUrl },
      );
      const file = path.join(artifactsDir, 'a11y-report.json');
      await write(file, JSON.stringify(res.report, null, 2));
      gates.push(res.gate);
      reports.a11y = res.report;
      written.push(file);
    }
  }

  const browser = cfg.performance.browser;
  if (browser.enabled) {
    const { routes, skippedCount } = resolveChangedRoutes(
      changeSurface,
      browser.routes,
      baseUrl,
      browser.maxRoutesPerRun,
    );
    if (routes.length === 0) {
      input.logger?.info('perf: no changed routes matched performance.browser.routes; skipping');
    } else {
      if (skippedCount > 0) {
        input.logger?.info(
          `perf: auditing ${routes.length} route(s); ${skippedCount} over the cap skipped`,
        );
      }
      const audit = input.perfAudit ?? runLighthouseAudit;
      const budgets: PerfBudgetConfig = {
        ...browser.budgets,
        warnMarginPercent: browser.warnMarginPercent,
      };
      const res: RunLighthouseResult = await audit(routes, budgets, { baseUrl });
      const file = path.join(artifactsDir, 'perf-report.json');
      await write(file, JSON.stringify(res.report, null, 2));
      gates.push(res.gate);
      reports.perf = res.report;
      written.push(file);
    }
  }

  return { gates, reports, written };
}
