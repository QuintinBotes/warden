import { defaultFetch, postJson, type FetchLike } from '../fetch-like.js';
import type { ChannelSender } from '../channel-sender.js';
import type { NotificationMessage } from '../message-builder.js';

export interface SlackSenderOptions {
  /** A Slack "Incoming Webhook" URL. */
  webhookUrl: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

function slackColor(severity: NotificationMessage['severity']): string {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'good';
  }
}

function buildBlocks(message: NotificationMessage): unknown[] {
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: message.title, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: message.summary } },
  ];

  if (message.details.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: message.details.map((d) => `• ${d}`).join('\n') },
    });
  }

  const linkElements: string[] = [];
  if (message.links.prUrl) linkElements.push(`<${message.links.prUrl}|View PR>`);
  if (message.links.dashboardExecutionUrl) {
    linkElements.push(`<${message.links.dashboardExecutionUrl}|Replay in dashboard>`);
  }
  if (linkElements.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: linkElements.join('  ·  ') }],
    });
  }

  return blocks;
}

/** `ChannelSender` that renders a `NotificationMessage` as Slack Block Kit and POSTs it. */
export function createSlackSender(opts: SlackSenderOptions): ChannelSender {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();

  return {
    name: 'slack',
    async send(message) {
      const payload = {
        text: message.title,
        attachments: [{ color: slackColor(message.severity), blocks: buildBlocks(message) }],
      };
      await postJson(fetchImpl, opts.webhookUrl, JSON.stringify(payload), {
        'content-type': 'application/json',
      });
    },
  };
}
