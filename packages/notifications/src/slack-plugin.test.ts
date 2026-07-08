import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from './fetch-like';
import { slackPlugin } from './slack-plugin';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({}) };
}

describe('slackPlugin', () => {
  it('caches PR + execution context and POSTs on a BLOCK gate decision', async () => {
    const calls: unknown[] = [];
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return okResponse();
    });

    const plugin = slackPlugin({ webhookUrl: 'https://hooks.slack.com/services/x', fetchImpl });

    await plugin.onPROpened?.({
      number: 482,
      title: 'checkout redesign',
      url: 'https://github.com/acme/shop/pull/482',
      headSha: 'h',
      baseSha: 'b',
    });
    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: '1 test failed' });

    expect(calls).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://hooks.slack.com/services/x', expect.anything());
  });

  it('does not send on a PASS decision by default (notifyOn defaults to BLOCK/WARN)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = slackPlugin({ webhookUrl: 'https://hooks.slack.com/services/x', fetchImpl });

    await plugin.onGateDecision?.({ decision: 'PASS', reason: 'all good' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not send a LOW-severity bug by default (bugSeverity defaults to CRITICAL/HIGH)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const plugin = slackPlugin({ webhookUrl: 'https://hooks.slack.com/services/x', fetchImpl });

    await plugin.onBugFound?.({
      title: 'minor UI nit',
      severity: 'LOW',
      steps: ['open page'],
      expected: 'aligned',
      actual: 'off by 1px',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
