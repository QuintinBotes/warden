import type { NotificationMessage } from './message-builder.js';

/**
 * A single outbound notification channel — renders a `NotificationMessage` into its own wire
 * format and POSTs it. Every implementation in `channels/*.ts` is a pure "render + POST": no
 * state, no caching — that lives in `notification-plugin.ts`.
 */
export interface ChannelSender {
  name: 'slack' | 'teams' | 'webhook' | 'pagerduty';
  send(message: NotificationMessage): Promise<void>;
}
