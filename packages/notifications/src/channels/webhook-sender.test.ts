import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like';
import type { NotificationMessage } from '../message-builder';
import { createWebhookSender } from './webhook-sender';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({}) };
}

function fixtureMessage(): NotificationMessage {
  return {
    event: 'gate_decision',
    title: '✅ PASS — PR #482: checkout redesign',
    summary: 'All tests passed',
    severity: 'info',
    details: [],
    links: { prUrl: 'https://github.com/acme/shop/pull/482' },
    at: new Date('2026-07-08T12:00:00.000Z'),
    dedupKey: '482:gate_decision',
  };
}

describe('createWebhookSender', () => {
  it('POSTs the plain NotificationMessage JSON with no signature header when no secret is set', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return okResponse();
    });

    const sender = createWebhookSender({ url: 'https://chatops.example.com/hook', fetchImpl });
    const message = fixtureMessage();
    await sender.send(message);

    expect(sender.name).toBe('webhook');
    expect(calls[0]?.url).toBe('https://chatops.example.com/hook');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['X-Warden-Signature']).toBeUndefined();
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.title).toBe(message.title);
    expect(body.dedupKey).toBe('482:gate_decision');
  });

  it('HMAC-SHA256-signs the payload as X-Warden-Signature when a secret is configured', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return okResponse();
    });

    const sender = createWebhookSender({
      url: 'https://chatops.example.com/hook',
      secret: 'top-secret',
      fetchImpl,
    });
    const message = fixtureMessage();
    await sender.send(message);

    const body = String(calls[0]?.init?.body);
    const expectedSignature = createHmac('sha256', 'top-secret').update(body).digest('hex');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['X-Warden-Signature']).toBe(expectedSignature);
  });

  it('throws when the endpoint responds with a non-2xx status', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const sender = createWebhookSender({ url: 'https://chatops.example.com/hook', fetchImpl });

    await expect(sender.send(fixtureMessage())).rejects.toThrow();
  });
});
