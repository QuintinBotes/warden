import { z } from 'zod';
import type { GateDecision } from './change-surface';
import { evaluatePassRateGate } from './gates';
import { Priority, type TestStatus } from './schema';

/**
 * The merge gate — one implementation, shared by every caller.
 *
 * Warden used to carry two: `evaluateExitCriteria` in the orchestrator, which read the
 * `gates.*` config and which nothing ever called, and `computeGateDecision` in the reporter,
 * which is what `warden run` and `warden report aggregate` actually used and which read no
 * config at all. The configured policy was therefore inert in both directions: a repo that
 * loosened the gate on purpose still got a BLOCK, and a repo that tightened it got no extra
 * enforcement. Two gates cannot disagree if there is only one, so both now delegate here.
 */

export const GatesSchema = z
  .object({
    /** A failure on a test marked `P1` blocks, even when the pass-rate floor is cleared. */
    blockOnCritical: z.boolean().default(true),
    /**
     * The gate blocks when the share of results that ended green falls below this percentage.
     * SKIP and BLOCKED count against it, so a run that measured almost nothing cannot read as
     * a pass — a `--grep` that matched nothing, or a fixture that skipped the rest.
     *
     * It is not a failure allowance: a FAIL blocks unconditionally, whatever this is set to.
     * The default is 90, the number that has always been documented and shipped in the
     * `warden init` template. Set it to 0 to switch the rule off.
     */
    blockOnPassRateBelowPercent: z.number().default(90),
    /** More than this many `P2` failures blocks; at least one warns. */
    warnOnHighCount: z.number().default(2),
    /** Quarantine a flaky test after this many non-deterministic runs. */
    flakeQuarantineAfterRuns: z.number().default(3),
  })
  .default({});

/** The `gates` block of `WardenConfig` — the policy {@link evaluateGate} reads. */
export type GatePolicy = z.infer<typeof GatesSchema>;

/** The policy a caller with no config in hand evaluates against. */
export const DEFAULT_GATE_POLICY: GatePolicy = GatesSchema.parse(undefined);

/** The minimum a result must carry to be gated. `priority` is absent unless the runner said so. */
export interface GateableResult {
  status: TestStatus;
  priority?: Priority;
}

/**
 * Evaluates the configured merge gate over a set of results.
 *
 * Rules fire in severity order, so the most serious reason is the one reported. A FAIL and an
 * unfinished (BLOCKED) test each block unconditionally — neither is something a threshold
 * tolerates. The configured pass rate is then a floor on how much of the run produced a green
 * answer at all: SKIP and BLOCKED count against it, because a suite that skipped most of itself
 * measured almost nothing. A FLAKY result counts as green — it is a test that passed on a retry,
 * and flakiness has its own gates (`flake.gate`, `gates.flakeQuarantineAfterRuns`); charging it
 * here would block the run before those could speak.
 */
export function evaluateGate(results: GateableResult[], policy: GatePolicy): GateDecision {
  // Zero results is not a pass — a silently-empty or unparseable report must never read as a
  // confident green. WARN surfaces the anomaly without hard-blocking legitimate no-test changes.
  if (results.length === 0) {
    return { decision: 'WARN', reason: 'no tests ran' };
  }

  const count = (fn: (r: GateableResult) => boolean) => results.filter(fn).length;
  const passed = count((r) => r.status === 'PASS');
  const failed = count((r) => r.status === 'FAIL');
  const flaky = count((r) => r.status === 'FLAKY');
  const p1Fails = count((r) => r.status === 'FAIL' && r.priority === 'P1');
  const p2Fails = count((r) => r.status === 'FAIL' && r.priority === 'P2');

  if (p1Fails > 0 && policy.blockOnCritical) {
    return { decision: 'BLOCK', reason: `${p1Fails} critical (P1) test(s) failed` };
  }

  if (p2Fails > policy.warnOnHighCount) {
    return {
      decision: 'BLOCK',
      reason: `${p2Fails} high-priority (P2) test(s) failed, above the threshold of ${policy.warnOnHighCount}`,
    };
  }

  // Any failure blocks. This is deliberately not graded by the pass-rate floor: the floor
  // asks "did enough of this run produce an answer", and a red test produced one.
  if (failed > 0) {
    return { decision: 'BLOCK', reason: `${failed} test(s) failed` };
  }

  // A BLOCKED test started and never finished — a run cut short by `--max-failures`, a global
  // timeout, or a cancelled CI job leaves every unfinished test here. Its result is unknown, so
  // the tests that did finish are a partial answer: reading that partial answer as the whole one
  // is how "the payment test never ran" becomes "All tests passed". Unknown fails closed, and it
  // is reported ahead of the pass rate because "did not finish" is the reason a reader wants.
  const blocked = count((r) => r.status === 'BLOCKED');
  if (blocked > 0) {
    return { decision: 'BLOCK', reason: `${blocked} test(s) did not finish` };
  }

  // The configured pass-rate floor, shared with the orchestrator's `evaluateExitCriteria` so
  // the two gates cannot drift apart again.
  const passRate = evaluatePassRateGate(results, policy);
  if (passRate) {
    return passRate;
  }

  if (flaky > 0) {
    return { decision: 'WARN', reason: `${flaky} test(s) flaky` };
  }

  // Tests ran but nothing actually passed — every result was skipped. (A failed or blocked run
  // already returned above.) "Nothing passed" must never read as "All tests passed". Reachable
  // with the pass-rate floor turned off (`blockOnPassRateBelowPercent: 0`), which is the one
  // setting that would otherwise let a 0% run through.
  if (passed === 0) {
    const skipped = count((r) => r.status === 'SKIP');
    return { decision: 'WARN', reason: `no tests passed (${skipped} skipped)` };
  }

  return { decision: 'PASS', reason: 'All tests passed' };
}

/**
 * Reads a `Priority` off whatever the runner attached to a CTRF test: `extra.priority` (the
 * field the CTRF blueprint uses) or a `P1`/`@P2`-style tag, which is how a Playwright suite
 * marks criticality. Anything else is `undefined` — an unmarked test is not silently assigned
 * a priority, because that would make `blockOnCritical` fire on tests nobody classified.
 */
export function readPriority(source: {
  tags?: string[] | undefined;
  extra?: Record<string, unknown> | undefined;
}): Priority | undefined {
  const fromExtra = Priority.safeParse(source.extra?.['priority']);
  if (fromExtra.success) return fromExtra.data;

  for (const tag of source.tags ?? []) {
    const parsed = Priority.safeParse(tag.replace(/^@/, '').toUpperCase());
    if (parsed.success) return parsed.data;
  }
  return undefined;
}
