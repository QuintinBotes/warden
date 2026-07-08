import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like';
import type { NotificationMessage } from '../message-builder';
import { createTeamsSender } from './teams-sender';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({}) };
}

function fixtureMessage(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    event: 'bug_found',
    title: '🐛 CRITICAL — Payment fails for Visa 4242',
    summary: 'expected: Payment confirmed — actual: Error processing payment',
    severity: 'critical',
    details: ['Add to cart', 'Checkout'],
    links: { prUrl: 'https://github.com/acme/shop/pull/482' },
    at: new Date('2026-07-08T12:00:00.000Z'),
    dedupKey: '482:bug_found',
    ...overrides,
  };
}

describe('createTeamsSender', () => {
  it('POSTs an Adaptive Card matching the Teams/Power Automate schema', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return okResponse();
    });

    const sender = createTeamsSender({
      webhookUrl: 'https://outlook.office.com/webhook/x',
      fetchImpl,
    });
    await sender.send(fixtureMessage());

    expect(sender.name).toBe('teams');
    expect(calls[0]?.url).toBe('https://outlook.office.com/webhook/x');
    const body = JSON.parse(String(calls[0]?.init?.body));

    expect(body.type).toBe('message');
    const card = body.attachments[0];
    expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(card.content.type).toBe('AdaptiveCard');
    expect(card.content.$schema).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
    expect(JSON.stringify(card.content.body)).toContain('Payment fails for Visa 4242');
    const factSet = card.content.body.find((b: { type: string }) => b.type === 'FactSet');
    expect(factSet.facts).toHaveLength(2);
    expect(card.content.actions).toEqual([
      { type: 'Action.OpenUrl', title: 'View PR', url: 'https://github.com/acme/shop/pull/482' },
    ]);
  });

  it('omits the actions array when there are no links', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const sender = createTeamsSender({
      webhookUrl: 'https://outlook.office.com/webhook/x',
      fetchImpl,
    });

    await sender.send(fixtureMessage({ links: {} }));

    const call = vi.mocked(fetchImpl).mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.attachments[0].content.actions).toBeUndefined();
  });
});
