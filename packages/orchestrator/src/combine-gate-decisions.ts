import type { GateDecision } from '@warden/core';

const SEVERITY: Record<GateDecision['decision'], number> = { PASS: 0, WARN: 1, BLOCK: 2 };

/**
 * Combines several independently-computed gate decisions (functional tiers + a11y + perf budget,
 * etc.) into one, worst-first (`BLOCK` > `WARN` > `PASS`). Reasons from every non-`PASS` decision
 * are joined so the combined decision explains every rule that fired, not just the first.
 * An empty list is a vacuous `PASS`.
 */
export function combineGateDecisions(decisions: GateDecision[]): GateDecision {
  if (decisions.length === 0) {
    return { decision: 'PASS', reason: 'no gate decisions to combine' };
  }

  const worst = decisions.reduce((a, b) => (SEVERITY[b.decision] > SEVERITY[a.decision] ? b : a));

  if (worst.decision === 'PASS') {
    return { decision: 'PASS', reason: decisions.map((d) => d.reason).join('; ') };
  }

  // Every non-PASS decision explains a rule that fired, regardless of its own severity, so a
  // BLOCK's reason never hides a WARN that also fired.
  const reasons = decisions.filter((d) => d.decision !== 'PASS').map((d) => d.reason);
  return { decision: worst.decision, reason: reasons.join('; ') };
}
