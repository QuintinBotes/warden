import { describe, expect, it } from 'vitest';
import type { GridCapability } from '@warden/core';
import { planShards } from './plan-shards';

function cap(id: string, over: Partial<GridCapability> = {}): GridCapability {
  return { id, browser: 'chromium', platform: 'linux', real: false, ...over };
}

const A = cap('local:chromium');
const B = cap('local:webkit', { browser: 'webkit' });
const C = cap('local:firefox', { browser: 'firefox' });

describe('planShards', () => {
  it('gives every lane×tag work item at least one shard and spends the whole budget', () => {
    const plan = planShards({
      capabilities: [A, B],
      tierTags: ['@smoke'],
      maxShards: 4,
      balanceBy: 'count',
    });
    expect(plan.shards).toHaveLength(4);
    expect(plan.skippedLanes).toEqual([]);
    expect(plan.lanes).toEqual([A, B]);
    // Two work items, four shards → each lane split into two Playwright shards.
    const aShards = plan.shards.filter((s) => s.lane.id === 'local:chromium');
    const bShards = plan.shards.filter((s) => s.lane.id === 'local:webkit');
    expect(aShards.map((s) => s.playwrightShard)).toEqual(['1/2', '2/2']);
    expect(bShards.map((s) => s.playwrightShard)).toEqual(['1/2', '2/2']);
    expect(aShards.every((s) => s.grep === '@smoke')).toBe(true);
  });

  it('materializes playwrightShard as `${index}/${total}` and threads the grep through', () => {
    const plan = planShards({
      capabilities: [A],
      tierTags: ['@apps/checkout'],
      maxShards: 3,
      balanceBy: 'count',
    });
    expect(plan.shards).toHaveLength(3);
    expect(plan.shards.map((s) => s.playwrightShard)).toEqual(['1/3', '2/3', '3/3']);
    expect(plan.shards.map((s) => `${s.index}/${s.total}`)).toEqual(['1/3', '2/3', '3/3']);
    expect(plan.shards.every((s) => s.grep === '@apps/checkout')).toBe(true);
  });

  it('balances the fan-out by injected per-tag history when balanceBy=duration', () => {
    const plan = planShards({
      capabilities: [A],
      tierTags: ['@slow', '@fast'],
      maxShards: 4,
      balanceBy: 'duration',
      history: { '@slow': 300, '@fast': 100 },
    });
    const slow = plan.shards.filter((s) => s.grep === '@slow');
    const fast = plan.shards.filter((s) => s.grep === '@fast');
    // 4 shards weighted 300:100 → the heavier tag gets the extra slices.
    expect(slow).toHaveLength(3);
    expect(fast).toHaveLength(1);
    expect(slow.map((s) => s.playwrightShard)).toEqual(['1/3', '2/3', '3/3']);
    expect(fast.map((s) => s.playwrightShard)).toEqual(['1/1']);
  });

  it('falls back to round-robin (even) when history is empty', () => {
    const plan = planShards({
      capabilities: [A],
      tierTags: ['@one', '@two'],
      maxShards: 4,
      balanceBy: 'duration',
      // no history
    });
    const one = plan.shards.filter((s) => s.grep === '@one');
    const two = plan.shards.filter((s) => s.grep === '@two');
    expect(one).toHaveLength(2);
    expect(two).toHaveLength(2);
  });

  it('collapses lanes×tiers that exceed maxShards into skippedLanes (documented, not silent)', () => {
    const plan = planShards({
      capabilities: [A, B, C],
      tierTags: ['@smoke', '@api'],
      maxShards: 3,
      balanceBy: 'count',
    });
    // Keep the first 3 work items: (A,@smoke),(A,@api),(B,@smoke). All are single '1/1' shards.
    expect(plan.shards).toHaveLength(3);
    expect(plan.shards.every((s) => s.playwrightShard === '1/1')).toBe(true);
    // A and B were scheduled; only C never got a shard → exactly C is skipped.
    expect(plan.skippedLanes.map((s) => s.capability.id)).toEqual(['local:firefox']);
    expect(plan.skippedLanes[0]!.reason).toContain('maxShards');
  });

  it('treats no tier tags as a single untagged work item per lane', () => {
    const plan = planShards({
      capabilities: [A, B],
      tierTags: [],
      maxShards: 2,
      balanceBy: 'count',
    });
    expect(plan.shards).toHaveLength(2);
    expect(plan.shards.every((s) => s.grep === undefined)).toBe(true);
  });

  it('returns an empty plan for no capabilities', () => {
    const plan = planShards({
      capabilities: [],
      tierTags: ['@smoke'],
      maxShards: 4,
      balanceBy: 'count',
    });
    expect(plan).toEqual({ lanes: [], shards: [], skippedLanes: [] });
  });

  it('is deterministic: the same input reproduces the same plan', () => {
    const input = {
      capabilities: [A, B],
      tierTags: ['@smoke', '@api'],
      maxShards: 5,
      balanceBy: 'duration' as const,
      history: { '@smoke': 200, '@api': 50 },
    };
    expect(planShards(input)).toEqual(planShards(input));
  });
});
