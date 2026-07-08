import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like';
import type { NotificationMessage } from '../message-builder';
import { createPagerdutySender } from './pagerduty-sender';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 202, json: async () => ({ status: 'success' }) };
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

describe('createPagerdutySender', () => {
  it('POSTs a v2 trigger event with routing_key, event_action, and dedup_key', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return okResponse();
    });

    const sender = createPagerdutySender({ routingKey: 'routing-key-123', fetchImpl });
    await sender.send(fixtureMessage());

    expect(sender.name).toBe('pagerduty');
    expect(calls[0]?.url).toBe('https://events.pagerduty.com/v2/enqueue');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.routing_key).toBe('routing-key-123');
    expect(body.event_action).toBe('trigger');
    expect(body.dedup_key).toBe('482:gate_decision');
    expect(body.payload.severity).toBe('critical');
    expect(body.payload.summary).toBe('⛔ BLOCK — PR #482: checkout redesign');
    expect(body.links).toEqual([
      { href: 'https://github.com/acme/shop/pull/482', text: 'View PR' },
    ]);
  });

  it('omits dedup_key when the message has none', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const sender = createPagerdutySender({ routingKey: 'routing-key-123', fetchImpl });

    await sender.send(fixtureMessage({ dedupKey: undefined, links: {} }));

    const call = vi.mocked(fetchImpl).mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.dedup_key).toBeUndefined();
    expect(body.links).toBeUndefined();
  });

  it('supports overriding the events URL for tests / region-specific deployments', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const sender = createPagerdutySender({
      routingKey: 'x',
      eventsUrl: 'https://events.eu.pagerduty.com/v2/enqueue',
      fetchImpl,
    });

    await sender.send(fixtureMessage());

    const call = vi.mocked(fetchImpl).mock.calls[0];
    expect(call?.[0]).toBe('https://events.eu.pagerduty.com/v2/enqueue');
  });

  it('throws when the events API responds with a non-2xx status', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({}) });
    const sender = createPagerdutySender({ routingKey: 'x', fetchImpl });

    await expect(sender.send(fixtureMessage())).rejects.toThrow();
  });
});
