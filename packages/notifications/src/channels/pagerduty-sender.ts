import { defaultFetch, postJson, type FetchLike } from '../fetch-like.js';
import type { ChannelSender } from '../channel-sender.js';
import type { NotificationMessage } from '../message-builder.js';

const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export interface PagerdutySenderOptions {
  /** A PagerDuty Events API v2 integration routing key. */
  routingKey: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Overrides the Events API endpoint — for tests or region-specific deployments. */
  eventsUrl?: string;
}

function pagerdutySeverity(
  severity: NotificationMessage['severity'],
): 'critical' | 'warning' | 'info' {
  return severity;
}

/**
 * `ChannelSender` that POSTs a PagerDuty Events API v2 `trigger` event. `dedup_key` is derived
 * from the message's `dedupKey` (`${pr.number}:${event}`) so repeated gate decisions on the
 * same PR update one incident instead of paging twice.
 */
export function createPagerdutySender(opts: PagerdutySenderOptions): ChannelSender {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();
  const eventsUrl = opts.eventsUrl ?? PAGERDUTY_EVENTS_URL;

  return {
    name: 'pagerduty',
    async send(message) {
      const links = [
        ...(message.links.prUrl ? [{ href: message.links.prUrl, text: 'View PR' }] : []),
        ...(message.links.dashboardExecutionUrl
          ? [{ href: message.links.dashboardExecutionUrl, text: 'Replay in dashboard' }]
          : []),
      ];

      const payload = {
        routing_key: opts.routingKey,
        event_action: 'trigger',
        ...(message.dedupKey !== undefined && { dedup_key: message.dedupKey }),
        payload: {
          summary: message.title,
          severity: pagerdutySeverity(message.severity),
          source: 'warden',
          custom_details: { summary: message.summary, details: message.details },
        },
        ...(links.length > 0 && { links }),
      };

      await postJson(fetchImpl, eventsUrl, JSON.stringify(payload), {
        'content-type': 'application/json',
      });
    },
  };
}
