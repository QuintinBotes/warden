import type { GridCapability, ShardAssignment, ShardPlan, SkippedLane } from '@warden/core';

/**
 * Pure, deterministic shard planner. Crosses the resolved lanes with the tier tags the
 * orchestrator selected, fans the resulting work items across the `maxShards` CI ceiling, and
 * balances the fan-out by injected per-tag history (or round-robin when history is empty). Given
 * the same `(capabilities, tierTags, history)` it always returns the same plan, so a re-run
 * reproduces the lane→shard assignment.
 *
 * When `lanes × tags` exceed `maxShards` the surplus work items are collapsed into
 * {@link ShardPlan.skippedLanes} — the collapse is documented in the plan, never silent.
 */
export interface PlanShardsInput {
  capabilities: GridCapability[];
  /** Tier tags from the orchestrator's `selectTiers`, e.g. ['@smoke', '@apps/checkout']. */
  tierTags: string[];
  /** CI fan-out ceiling; lanes × shards collapse to this (documented, not silent). */
  maxShards: number;
  balanceBy: 'duration' | 'count';
  /** Injected per-tag historical durations (from @warden/test-management); empty → round-robin. */
  history?: Record<string, number>;
}

/** One (lane, tag) unit of work, before it is split into Playwright `--shard` slices. */
interface WorkItem {
  lane: GridCapability;
  grep?: string;
  weight: number;
}

const DEFAULT_WEIGHT = 1;

/**
 * Distribute `extra` additional shards across `weights` using the largest-remainder method, so the
 * total handed out equals exactly `extra`. Deterministic: ties break toward earlier indices.
 */
function distributeExtras(weights: number[], extra: number): number[] {
  const out = weights.map(() => 0);
  if (extra <= 0 || weights.length === 0) return out;

  const totalWeight = weights.reduce((a, w) => a + w, 0);
  // Degenerate (all-zero weights) → even round-robin.
  const effective = totalWeight > 0 ? weights : weights.map(() => 1);
  const effTotal = effective.reduce((a, w) => a + w, 0);

  const quotas = effective.map((w) => (extra * w) / effTotal);
  const floors = quotas.map((q) => Math.floor(q));
  let allocated = floors.reduce((a, f) => a + f, 0);
  for (let i = 0; i < floors.length; i++) out[i] = floors[i]!;

  let remaining = extra - allocated;
  // Hand out the leftover to the largest fractional remainders, earliest index wins ties.
  const order = quotas
    .map((q, i) => ({ i, frac: q - Math.floor(q) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remaining > 0; k = (k + 1) % order.length) {
    const idx = order[k]!.i;
    out[idx] = (out[idx] ?? 0) + 1;
    remaining -= 1;
    allocated += 1;
    if (allocated >= extra) break;
  }
  return out;
}

export function planShards(input: PlanShardsInput): ShardPlan {
  const lanes = input.capabilities;
  const tags = input.tierTags.length > 0 ? input.tierTags : [undefined];
  const history = input.history ?? {};
  const budget = Math.max(0, Math.floor(input.maxShards));

  // Build (lane × tag) work items in deterministic lane-major, tag-minor order.
  const workItems: WorkItem[] = [];
  for (const lane of lanes) {
    for (const grep of tags) {
      const weight =
        input.balanceBy === 'duration' && grep !== undefined
          ? (history[grep] ?? DEFAULT_WEIGHT)
          : DEFAULT_WEIGHT;
      workItems.push({ lane, grep, weight });
    }
  }

  const shards: ShardAssignment[] = [];
  const scheduledLanes = new Set<string>();
  const skippedWork: WorkItem[] = [];

  if (workItems.length <= budget) {
    // Every work item gets at least one shard; spread the surplus budget by weight.
    const extras = distributeExtras(
      workItems.map((w) => w.weight),
      budget - workItems.length,
    );
    for (let i = 0; i < workItems.length; i++) {
      const item = workItems[i]!;
      const count = 1 + extras[i]!;
      for (let s = 1; s <= count; s++) {
        shards.push({
          index: s,
          total: count,
          playwrightShard: `${s}/${count}`,
          lane: item.lane,
          grep: item.grep,
        });
      }
      scheduledLanes.add(item.lane.id);
    }
  } else {
    // More work items than the CI ceiling: keep the first `budget`, collapse the rest.
    for (let i = 0; i < workItems.length; i++) {
      const item = workItems[i]!;
      if (i < budget) {
        shards.push({
          index: 1,
          total: 1,
          playwrightShard: '1/1',
          lane: item.lane,
          grep: item.grep,
        });
        scheduledLanes.add(item.lane.id);
      } else {
        skippedWork.push(item);
      }
    }
  }

  // A lane is skipped only if none of its work items were scheduled at all.
  const skippedLanes: SkippedLane[] = [];
  const seenSkipped = new Set<string>();
  for (const item of skippedWork) {
    if (scheduledLanes.has(item.lane.id) || seenSkipped.has(item.lane.id)) continue;
    seenSkipped.add(item.lane.id);
    skippedLanes.push({
      capability: item.lane,
      reason: `collapsed: ${workItems.length} lane×tier work items exceed maxShards (${budget})`,
    });
  }

  return { lanes, shards, skippedLanes };
}
