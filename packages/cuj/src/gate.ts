import type {
  CujHealthReport,
  CujHealthStatus,
  GateDecision,
  TouchedCuj,
  WardenConfig,
} from '@warden/core';
import { statusSeverity } from './health.js';

/**
 * The CUJ-scoped merge gate. For each CUJ a change *touches*, it compares after-health against a
 * baseline and returns a standard `GateDecision` so it composes with the exit-criteria gate with
 * no changes downstream. Per-CUJ decisions fold most-severe-wins into one decision.
 */

const DECISION_SEVERITY: Record<GateDecision['decision'], number> = { PASS: 0, WARN: 1, BLOCK: 2 };

/**
 * Worst-of composition of several gate decisions. `BLOCK` > `WARN` > `PASS`; the reasons of
 * every non-`PASS` decision are preserved so a `BLOCK`'s reason never hides a `WARN` that also
 * fired. An empty list is a `WARN` — "nothing to combine" must never read as a green gate.
 */
export function mergeGateDecisions(...decisions: GateDecision[]): GateDecision {
  if (decisions.length === 0) {
    return { decision: 'WARN', reason: 'no gate decisions to combine' };
  }
  const worst = decisions.reduce((a, b) =>
    DECISION_SEVERITY[b.decision] > DECISION_SEVERITY[a.decision] ? b : a,
  );
  if (worst.decision === 'PASS') {
    return { decision: 'PASS', reason: decisions.map((d) => d.reason).join('; ') };
  }
  const reasons = decisions.filter((d) => d.decision !== 'PASS').map((d) => d.reason);
  return { decision: worst.decision, reason: reasons.join('; ') };
}

const TIER_LABEL: Record<TouchedCuj['cuj']['tier'], string> = {
  tier1: 'tier-1',
  tier2: 'tier-2',
  tier3: 'tier-3',
};

/** A baseline is meaningful only when it exists and was actually tested. */
function hasBaseline(before: CujHealthReport | undefined): before is CujHealthReport {
  return before !== undefined && before.status !== 'NOT_TESTED';
}

function decideForCuj(
  touched: TouchedCuj,
  before: CujHealthReport | undefined,
  after: CujHealthReport,
  cfg: WardenConfig,
): GateDecision {
  const { tier, name } = touched.cuj;
  const tierLabel = TIER_LABEL[tier];
  const gate = cfg.cuj.gate;

  // A broken touched journey blocks regardless of history (when configured to).
  if (after.status === 'BROKEN' && gate.blockOnBroken) {
    return {
      decision: 'BLOCK',
      reason: `Blocked: ${tierLabel} journey '${name}' is BROKEN.`,
    };
  }

  // A touched journey with no result this run verified nothing — it must not read as "healthy",
  // even against a DEGRADED/BROKEN baseline (NOT_TESTED sorts below those, so the regression
  // check below would miss it). Surface it as a WARN.
  if (after.status === 'NOT_TESTED') {
    return {
      decision: 'WARN',
      reason: `Warning: ${tierLabel} journey '${name}' was not tested this run.`,
    };
  }

  const afterSeverity = statusSeverity(after.status);
  const baseline = hasBaseline(before);
  const beforeStatus: CujHealthStatus = baseline ? before.status : 'HEALTHY';
  const regressed = afterSeverity > statusSeverity(beforeStatus);

  if (!regressed) {
    return {
      decision: 'PASS',
      reason: `Journey '${name}' healthy vs baseline (${beforeStatus} → ${after.status}).`,
    };
  }

  const transition = `${beforeStatus} → ${after.status}`;

  // No baseline: a regression can't be *proven*, so a degrade only WARNs (a BROKEN was already
  // handled above). This keeps first-adoption from tripping the gate on itself.
  if (!baseline) {
    return {
      decision: 'WARN',
      reason: `Warning: ${tierLabel} journey '${name}' is ${after.status} with no baseline to compare (${transition}).`,
    };
  }

  if (tier === 'tier1' && gate.blockTier1OnDegrade) {
    return {
      decision: 'BLOCK',
      reason: `Blocked: ${tierLabel} journey '${name}' regressed ${transition}.`,
    };
  }
  if (tier === 'tier2' && gate.warnTier2OnDegrade) {
    return {
      decision: 'WARN',
      reason: `Warning: ${tierLabel} journey '${name}' regressed ${transition}.`,
    };
  }
  // tier3 (or a tier whose gate switch is off) is informational only.
  return {
    decision: 'PASS',
    reason: `Note: ${tierLabel} journey '${name}' regressed ${transition} (informational).`,
  };
}

export function evaluateCujGate(input: {
  touched: TouchedCuj[];
  before: CujHealthReport[];
  after: CujHealthReport[];
  cfg: WardenConfig;
}): GateDecision {
  const { touched, before, after, cfg } = input;

  // The gate only fires for touched CUJs, and only when enabled.
  if (!cfg.cuj.gate.enabled || touched.length === 0) {
    return { decision: 'PASS', reason: 'No touched CUJs to gate.' };
  }

  const beforeById = new Map(before.map((r) => [r.cujId, r]));
  const afterById = new Map(after.map((r) => [r.cujId, r]));

  const decisions: GateDecision[] = [];
  for (const t of touched) {
    const afterReport = afterById.get(t.cuj.id);
    if (!afterReport) continue; // no after-health computed → nothing to say for this CUJ
    decisions.push(decideForCuj(t, beforeById.get(t.cuj.id), afterReport, cfg));
  }

  if (decisions.length === 0) {
    return { decision: 'PASS', reason: 'No touched CUJs to gate.' };
  }
  return mergeGateDecisions(...decisions);
}
