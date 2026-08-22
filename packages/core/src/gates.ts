import type { GateDecision } from './change-surface';
import type { GatePolicy } from './gate-policy';
import type { TestStatus } from './schema';

/**
 * The one implementation of the configured pass-rate rule (`gates.blockOnPassRateBelowPercent`).
 *
 * It lives in core because two gates once computed merge verdicts independently: the
 * orchestrator's `evaluateExitCriteria` read the configured thresholds, and the reporters'
 * `computeGateDecision` — the function every production merge verdict actually comes from —
 * applied fixed rules and never saw a `WardenConfig` at all. They disagreed exactly where it
 * mattered: a run whose tests were nearly all skipped had a pass rate the configured gate
 * blocks on, and the real gate called it "All tests passed". One implementation, shared by
 * both callers, is what stops that from happening again.
 *
 * Returns the BLOCK when the rule fires and `undefined` when it does not, so a caller folds it
 * into its own ordering rather than having the verdict decided for it.
 */
export function evaluatePassRateGate(
  results: ReadonlyArray<{ status: TestStatus }>,
  gates: GatePolicy,
): GateDecision | undefined {
  // An empty result set has no pass rate: 0/0 is neither 0% nor 100%, and manufacturing either
  // is a claim about a run that measured nothing. Callers report "no tests ran" themselves.
  if (results.length === 0) {
    return undefined;
  }

  // A result counts toward the rate when it ended green: PASS, or FLAKY, which is a test that
  // passed on a retry. Flakiness is gated separately (`flake.gate`, `gates.flakeQuarantineAfterRuns`)
  // and counting it here too would block the run before that gate could ever speak.
  //
  // A SKIP and a BLOCKED do not count. Neither one produced an answer, and a suite that skipped
  // most of itself measured almost nothing — treating "not run" as "fine" is how a `--grep` that
  // matched nothing, or a fixture that skipped the rest, reads as a green merge.
  const greenCount = results.filter((r) => r.status === 'PASS' || r.status === 'FLAKY').length;
  const passRatePercent = (greenCount / results.length) * 100;

  if (passRatePercent >= gates.blockOnPassRateBelowPercent) {
    return undefined;
  }

  return {
    decision: 'BLOCK',
    reason: `Blocked: pass rate ${passRatePercent.toFixed(1)}% is below the required ${gates.blockOnPassRateBelowPercent}%.`,
  };
}
