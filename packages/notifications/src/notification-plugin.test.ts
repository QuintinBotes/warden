import { describe, expect, it } from 'vitest';
import type { ExploratoryFinding, PullRequest } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import type { ChannelSender } from './channel-sender';
import type { NotificationMessage } from './message-builder';
import { createNotificationPlugin } from './notification-plugin';

function recordingSender(name: ChannelSender['name'] = 'webhook'): ChannelSender & {
  sent: NotificationMessage[];
} {
  const sent: NotificationMessage[] = [];
  return {
    name,
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

function fixturePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 482,
    title: 'checkout redesign',
    url: 'https://github.com/acme/shop/pull/482',
    headSha: 'head-sha',
    baseSha: 'base-sha',
    ...overrides,
  };
}

function fixtureFinding(overrides: Partial<ExploratoryFinding> = {}): ExploratoryFinding {
  return {
    title: 'Payment fails for Visa 4242',
    severity: 'CRITICAL',
    steps: ['Add to cart', 'Checkout'],
    expected: 'Payment confirmed',
    actual: 'Error processing payment',
    ...overrides,
  };
}

const NOW = () => new Date('2026-07-08T12:00:00.000Z');

describe('createNotificationPlugin', () => {
  it('drives onPROpened -> onTestExecutionComplete -> onGateDecision and the cached PR/topFailures reach the final message', async () => {
    const sender = recordingSender();
    const plugin = createNotificationPlugin('test-channel', sender, { now: NOW });
    const pr = fixturePr();

    await plugin.onPROpened?.(pr);

    const execution = fixtureExecution({
      results: [
        {
          testCaseId: 'checkout-pay',
          status: 'FAIL',
          duration: 100,
          retries: 0,
          flakeFlag: false,
          errorMessage: 'boom',
        },
        { testCaseId: 'checkout-cart', status: 'PASS', duration: 50, retries: 0, flakeFlag: false },
      ],
    });
    await plugin.onTestExecutionComplete?.(execution, execution.results);

    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: '1 test failed' });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.links.prUrl).toBe(pr.url);
    expect(sender.sent[0]?.details).toEqual(['checkout-pay — boom']);
    expect(sender.sent[0]?.title).toContain('PR #482');
  });

  it('drives onBugFound and includes the cached PR in the bug message', async () => {
    const sender = recordingSender();
    const plugin = createNotificationPlugin('test-channel', sender, { now: NOW });
    await plugin.onPROpened?.(fixturePr());

    await plugin.onBugFound?.(fixtureFinding());

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.event).toBe('bug_found');
    expect(sender.sent[0]?.title).toContain('PR #482');
  });

  it('suppresses a gate send when the decision is not in notifyOn', async () => {
    const sender = recordingSender();
    const plugin = createNotificationPlugin('test-channel', sender, {
      notifyOn: ['BLOCK'],
      now: NOW,
    });

    await plugin.onGateDecision?.({ decision: 'PASS', reason: 'all good' });
    await plugin.onGateDecision?.({ decision: 'WARN', reason: 'flaky' });

    expect(sender.sent).toHaveLength(0);

    await plugin.onGateDecision?.({ decision: 'BLOCK', reason: '1 failed' });
    expect(sender.sent).toHaveLength(1);
  });

  it('suppresses a bug send when the severity is not in bugSeverity', async () => {
    const sender = recordingSender();
    const plugin = createNotificationPlugin('test-channel', sender, {
      bugSeverity: ['CRITICAL'],
      now: NOW,
    });

    await plugin.onBugFound?.(fixtureFinding({ severity: 'LOW' }));
    expect(sender.sent).toHaveLength(0);

    await plugin.onBugFound?.(fixtureFinding({ severity: 'CRITICAL' }));
    expect(sender.sent).toHaveLength(1);
  });

  it('propagates a rejecting sender.send instead of swallowing it (firePluginHooks is responsible for that)', async () => {
    const sender: ChannelSender = {
      name: 'webhook',
      send: () => Promise.reject(new Error('network timeout')),
    };
    const plugin = createNotificationPlugin('test-channel', sender, { now: NOW });

    await expect(plugin.onGateDecision?.({ decision: 'BLOCK', reason: 'x' })).rejects.toThrow(
      'network timeout',
    );
  });

  it('includes a dashboardExecutionUrl once dashboardBaseUrl and an execution are both known', async () => {
    const sender = recordingSender();
    const plugin = createNotificationPlugin('test-channel', sender, {
      dashboardBaseUrl: 'https://qa.example.com',
      now: NOW,
    });

    const execution = fixtureExecution({ id: 'exec-42', results: [] });
    await plugin.onTestExecutionComplete?.(execution, execution.results);
    await plugin.onGateDecision?.({ decision: 'PASS', reason: 'ok' });

    expect(sender.sent[0]?.links.dashboardExecutionUrl).toBe(
      'https://qa.example.com/executions/exec-42',
    );
  });
});
