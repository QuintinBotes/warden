import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from './fetch-like';
import { webhookPlugin } from './webhook-plugin';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({}) };
}

describe('webhookPlugin', () => {
  it('sends on PASS by default (broader notifyOn than Slack/Teams)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = webhookPlugin({ url: 'https://chatops.example.com/hook', fetchImpl });

    await plugin.onGateDecision?.({ decision: 'PASS', reason: 'all good' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('signs the payload when a secret is configured', async () => {
    const calls: { headers?: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      calls.push({ headers: init?.headers as Record<string, string> });
      return okResponse();
    });
    const plugin = webhookPlugin({
      url: 'https://chatops.example.com/hook',
      secret: 'shh',
      fetchImpl,
    });

    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: 'failed' });

    expect(calls[0]?.headers?.['X-Warden-Signature']).toBeDefined();
  });

  it('sends on a LOW-severity bug by default (broadest bugSeverity)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = webhookPlugin({ url: 'https://chatops.example.com/hook', fetchImpl });

    await plugin.onBugFound?.({
      title: 'minor UI nit',
      severity: 'LOW',
      steps: ['open page'],
      expected: 'aligned',
      actual: 'off by 1px',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
