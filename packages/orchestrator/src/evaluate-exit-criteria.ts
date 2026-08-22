import {
  evaluateGate,
  type GateDecision,
  type GateableResult,
  type WardenConfig,
} from '@warden/core';

/**
 * Evaluate the quality gate for a set of results, returning a PASS / WARN / BLOCK decision
 * with a human-readable reason explaining which rule fired.
 *
 * The rules themselves live in `@warden/core`'s `evaluateGate`, which is also what the reporter's
 * `computeGateDecision` calls. This function used to carry its own copy of them — a copy nothing
 * in the product ever called, so the `gates.*` config it read had no effect on any real run.
 */
export function evaluateExitCriteria(results: GateableResult[], cfg: WardenConfig): GateDecision {
  return evaluateGate(results, cfg.gates);
}
