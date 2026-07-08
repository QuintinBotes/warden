import { describe, expect, it, vi } from 'vitest';
import { WardenError } from '@warden/core';
import type { FetchLike, FetchResponseLike } from './fetch-like';
import { createNotificationPlugins, type NotificationsConfig } from './create-notification-plugins';

function okResponse(): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({}) };
}

describe('createNotificationPlugins', () => {
  it('returns an empty list when every channel is off (the default)', () => {
    const plugins = createNotificationPlugins({});
    expect(plugins).toEqual([]);
  });

  it('constructs only the enabled channel when one is on', () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const cfg: NotificationsConfig = { slack: { enabled: true } };

    const plugins = createNotificationPlugins(cfg, {
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      fetchImpl,
    });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe('slack');
  });

  it('constructs all four channels when all are on', () => {
    const fetchImpl: FetchLike = vi.fn(async () => okResponse());
    const cfg: NotificationsConfig = {
      slack: { enabled: true },
      teams: { enabled: true },
      webhook: { enabled: true },
      pagerduty: { enabled: true },
    };

    const plugins = createNotificationPlugins(cfg, {
      slackWebhookUrl: 'https://hooks.slack.com/services/x',
      teamsWebhookUrl: 'https://outlook.office.com/webhook/x',
      webhookUrl: 'https://chatops.example.com/hook',
      pagerdutyRoutingKey: 'rk-1',
      fetchImpl,
    });

    expect(plugins.map((p) => p.name).sort()).toEqual(['pagerduty', 'slack', 'teams', 'webhook']);
  });

  it('throws NOTIFICATION_MISSING_CONFIG when slack is enabled without a webhook URL', () => {
    expect(() => createNotificationPlugins({ slack: { enabled: true } })).toThrow(WardenError);
    try {
      createNotificationPlugins({ slack: { enabled: true } });
      expect.fail('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WardenError);
      expect((err as WardenError).code).toBe('NOTIFICATION_MISSING_CONFIG');
    }
  });

  it('throws NOTIFICATION_MISSING_CONFIG when teams is enabled without a webhook URL', () => {
    expect(() => createNotificationPlugins({ teams: { enabled: true } })).toThrow(WardenError);
  });

  it('throws NOTIFICATION_MISSING_CONFIG when webhook is enabled without a URL', () => {
    expect(() => createNotificationPlugins({ webhook: { enabled: true } })).toThrow(WardenError);
  });

  it('throws NOTIFICATION_MISSING_CONFIG when pagerduty is enabled without a routing key', () => {
    expect(() => createNotificationPlugins({ pagerduty: { enabled: true } })).toThrow(WardenError);
  });

  it('does not throw for a channel left at its default disabled state', () => {
    expect(() => createNotificationPlugins({})).not.toThrow();
  });
});
