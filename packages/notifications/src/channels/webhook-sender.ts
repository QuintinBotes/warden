import { createHmac } from 'node:crypto';
import { defaultFetch, postJson, type FetchLike } from '../fetch-like.js';
import type { ChannelSender } from '../channel-sender.js';

export interface WebhookSenderOptions {
  /** Generic outbound webhook URL — an email relay, custom bot, or ChatOps endpoint. */
  url: string;
  /** When set, HMAC-SHA256-signs the payload and sends it as `X-Warden-Signature`. */
  secret?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

/** `ChannelSender` that POSTs the plain `NotificationMessage` JSON, optionally HMAC-signed. */
export function createWebhookSender(opts: WebhookSenderOptions): ChannelSender {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();

  return {
    name: 'webhook',
    async send(message) {
      const body = JSON.stringify(message);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.secret) {
        headers['X-Warden-Signature'] = createHmac('sha256', opts.secret)
          .update(body)
          .digest('hex');
      }
      await postJson(fetchImpl, opts.url, body, headers);
    },
  };
}
