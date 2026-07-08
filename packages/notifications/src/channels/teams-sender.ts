import { defaultFetch, postJson, type FetchLike } from '../fetch-like.js';
import type { ChannelSender } from '../channel-sender.js';
import type { NotificationMessage } from '../message-builder.js';

export interface TeamsSenderOptions {
  /**
   * A Teams "Incoming Webhook" connector URL, or a Power Automate workflow HTTP trigger URL.
   * Microsoft has been narrowing Office 365 connector webhooks in favor of Power Automate —
   * point this at whichever URL shape is current for your tenant; the payload shape below
   * (an Adaptive Card wrapped in a `message` activity) is accepted by both.
   */
  webhookUrl: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

function teamsColor(severity: NotificationMessage['severity']): string {
  switch (severity) {
    case 'critical':
      return 'attention';
    case 'warning':
      return 'warning';
    case 'info':
      return 'good';
  }
}

function buildCard(message: NotificationMessage): unknown {
  const body: unknown[] = [
    {
      type: 'TextBlock',
      text: message.title,
      weight: 'bolder',
      size: 'medium',
      wrap: true,
      color: teamsColor(message.severity),
    },
    { type: 'TextBlock', text: message.summary, wrap: true },
  ];

  if (message.details.length > 0) {
    body.push({
      type: 'FactSet',
      facts: message.details.map((detail, i) => ({ title: `${i + 1}.`, value: detail })),
    });
  }

  const actions: unknown[] = [];
  if (message.links.prUrl) {
    actions.push({ type: 'Action.OpenUrl', title: 'View PR', url: message.links.prUrl });
  }
  if (message.links.dashboardExecutionUrl) {
    actions.push({
      type: 'Action.OpenUrl',
      title: 'Replay in dashboard',
      url: message.links.dashboardExecutionUrl,
    });
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(actions.length > 0 && { actions }),
        },
      },
    ],
  };
}

/** `ChannelSender` that renders a `NotificationMessage` as a Teams Adaptive Card and POSTs it. */
export function createTeamsSender(opts: TeamsSenderOptions): ChannelSender {
  const fetchImpl = opts.fetchImpl ?? defaultFetch();

  return {
    name: 'teams',
    async send(message) {
      await postJson(fetchImpl, opts.webhookUrl, JSON.stringify(buildCard(message)), {
        'content-type': 'application/json',
      });
    },
  };
}
