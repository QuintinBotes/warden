import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from './fetch-like';
import { teamsPlugin } from './teams-plugin';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({}) };
}

describe('teamsPlugin', () => {
  it('POSTs an Adaptive Card on a WARN gate decision', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = teamsPlugin({ webhookUrl: 'https://outlook.office.com/webhook/x', fetchImpl });

    await plugin.onGateDecision?.({ decision: 'WARN', reason: 'flaky test' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://outlook.office.com/webhook/x',
      expect.anything(),
    );
  });

  it('respects a custom notifyOn filter', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = teamsPlugin({
      webhookUrl: 'https://outlook.office.com/webhook/x',
      notifyOn: ['BLOCK'],
      fetchImpl,
    });

    await plugin.onGateDecision?.({ decision: 'WARN', reason: 'flaky test' });
    expect(fetchImpl).not.toHaveBeenCalled();

    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: 'failed' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
