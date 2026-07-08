import type { CujHealthReport, CujSignal, TouchedCuj } from '@warden/core';
import type { ExecutionHistory } from './ports.js';
import { computeCujHealth } from './health.js';

/**
 * Resolves the *before*-health of the touched CUJs from the base ref's last execution, read
 * through the injected `ExecutionHistory` port. The result feeds `evaluateCujGate` as the
 * baseline each touched journey's after-health is compared against.
 *
 * A CUJ whose base ref has no matching results rolls up to `NOT_TESTED` — which the gate treats
 * as "no baseline", so a first-ever run can never cause a false BLOCK.
 */
export async function resolveCujBaseline(
  touched: TouchedCuj[],
  baseRef: string,
  history: ExecutionHistory,
  opts: { signalsByCuj?: Record<string, CujSignal[]>; now?: Date } = {},
): Promise<CujHealthReport[]> {
  const reports: CujHealthReport[] = [];
  for (const t of touched) {
    const testIds = new Set<string>();
    for (const step of t.cuj.steps) for (const id of step.testIds) testIds.add(id);

    const results = await history.latestForRef(baseRef, [...testIds]);
    reports.push(
      computeCujHealth(t.cuj, results, opts.signalsByCuj?.[t.cuj.id] ?? [], { now: opts.now }),
    );
  }
  return reports;
}
