import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from './fetch-like';
import { pagerdutyPlugin } from './pagerduty-plugin';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 202, json: async () => ({ status: 'success' }) };
}

describe('pagerdutyPlugin', () => {
  it('pages on BLOCK by default but not on WARN (narrower than notifyOn)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = pagerdutyPlugin({ routingKey: 'rk-1', fetchImpl });

    await plugin.onGateDecision?.({ decision: 'WARN', reason: 'flaky' });
    expect(fetchImpl).not.toHaveBeenCalled();

    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: 'failed' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('pages only CRITICAL bugs by default', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = pagerdutyPlugin({ routingKey: 'rk-1', fetchImpl });

    await plugin.onBugFound?.({
      title: 'nit',
      severity: 'HIGH',
      steps: [],
      expected: 'a',
      actual: 'b',
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await plugin.onBugFound?.({
      title: 'crash',
      severity: 'CRITICAL',
      steps: [],
      expected: 'a',
      actual: 'b',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('derives dedup_key from the cached PR number and event so re-runs update one incident', async () => {
    const calls: unknown[] = [];
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return okResponse();
    });
    const plugin = pagerdutyPlugin({ routingKey: 'rk-1', fetchImpl });

    await plugin.onPROpened?.({
      number: 482,
      title: 'checkout redesign',
      url: 'https://github.com/acme/shop/pull/482',
      headSha: 'h',
      baseSha: 'b',
    });
    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: 'failed' });
    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: 'failed again' });

    expect(calls).toHaveLength(2);
    expect((calls[0] as { dedup_key: string }).dedup_key).toBe('482:gate_decision');
    expect((calls[1] as { dedup_key: string }).dedup_key).toBe('482:gate_decision');
  });
});
