import {
  evaluateGate,
  type GateDecision,
  type GatePolicy,
  type ReportContext,
  type TestExecution,
} from '@warden/core';

/**
 * Derives a `GateDecision` from an execution and the repo's configured `gates` policy.
 *
 * The policy argument is what makes `gates.*` in `warden.config.ts` mean anything: this is the
 * gate `warden run` and `warden report aggregate` publish, and it previously read no config at
 * all. Callers holding a `ReportContext` pass `ctx.config.gates`.
 *
 * It is required rather than defaulted on purpose. This is the function every merge verdict in
 * the product comes from, and while it took no configuration the documented thresholds were read
 * by nothing on any production path. A required parameter is what makes the compiler, rather than
 * a reviewer, catch the next caller that would have skipped them.
 */
export function computeGateDecision(execution: TestExecution, policy: GatePolicy): GateDecision {
  return evaluateGate(execution.results, policy);
}

/**
 * The gate a reporter should publish: the run's final, folded-in decision when the caller put one
 * on the context, and only otherwise the tests-only derivation.
 *
 * `computeGateDecision` sees `execution` alone, so it cannot know about the accessibility,
 * performance-budget, flake-quarantine or CUJ tiers that `warden run` folds in worst-of. A
 * reporter that derived its own verdict published `✅ PASS` on a run the gate actually BLOCKed —
 * the merge was stopped, but every surface a reviewer looks at said the change was green.
 */
export function resolveGateDecision(execution: TestExecution, ctx: ReportContext): GateDecision {
  return ctx.gate ?? computeGateDecision(execution, ctx.config.gates);
}
