import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like';
import type { NotificationMessage } from '../message-builder';
import { createSlackSender } from './slack-sender';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({}) };
}

function fixtureMessage(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    event: 'gate_decision',
    title: '⛔ BLOCK — PR #482: checkout redesign',
    summary: '1 test(s) failed',
    severity: 'critical',
    details: ['checkout-pay — timeout'],
    links: { prUrl: 'https://github.com/acme/shop/pull/482' },
    at: new Date('2026-07-08T12:00:00.000Z'),
    dedupKey: '482:gate_decision',
    ...overrides,
  };
}

describe('createSlackSender', () => {
  it('POSTs to the configured webhook URL with Block Kit blocks', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return okResponse();
    });

    const sender = createSlackSender({
      webhookUrl: 'https://hooks.slack.com/services/x',
      fetchImpl,
    });
    await sender.send(fixtureMessage());

    expect(sender.name).toBe('slack');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://hooks.slack.com/services/x');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({ 'content-type': 'application/json' });

    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.text).toBe('⛔ BLOCK — PR #482: checkout redesign');
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].color).toBe('danger');
    const blocks = body.attachments[0].blocks;
    expect(blocks[0]).toMatchObject({ type: 'header' });
    expect(JSON.stringify(blocks)).toContain('checkout-pay — timeout');
    expect(JSON.stringify(blocks)).toContain('https://github.com/acme/shop/pull/482');
  });

  it('throws when the webhook responds with a non-2xx status', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const sender = createSlackSender({
      webhookUrl: 'https://hooks.slack.com/services/x',
      fetchImpl,
    });

    await expect(sender.send(fixtureMessage())).rejects.toThrow();
  });
});
