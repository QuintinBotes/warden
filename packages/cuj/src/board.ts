import type { Cuj, CujHealthReport, CujSignal, TestResult } from '@warden/core';
import { computeCujHealth } from './health.js';

/**
 * The pure CUJ-board projection: every CUJ rolled up to its current `CujHealthReport`, ready for
 * the dashboard's "are our journeys green?" view. Results are looked up per CUJ via
 * `resultsFor` (the store adapter fetches each linked test's latest result); an optional
 * `signalsByCuj` folds in already-evaluated non-functional signals.
 *
 * Kept pure and hermetic so it can be unit-tested with an in-memory results map — the
 * `SqliteCujBoardApi` in `@warden/dashboard-api` is a thin adapter over this.
 */
export function projectCujBoard(
  cujs: Cuj[],
  resultsFor: (cuj: Cuj) => TestResult[],
  opts: { signalsByCuj?: Record<string, CujSignal[]>; now?: Date } = {},
): CujHealthReport[] {
  return cujs.map((cuj) =>
    computeCujHealth(cuj, resultsFor(cuj), opts.signalsByCuj?.[cuj.id] ?? [], { now: opts.now }),
  );
}
