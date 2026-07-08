import { describe, expect, it } from 'vitest';
import type { ExploratoryFinding, GateDecision, PullRequest } from '@warden/core';
import { buildBugMessage, buildGateMessage, type NotificationContext } from './message-builder';

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

const NOW = () => new Date('2026-07-08T12:00:00.000Z');

describe('buildGateMessage', () => {
  it('composes a BLOCK message with the PR title, reason, and top failures', () => {
    const decision: GateDecision = { decision: 'BLOCK', reason: '2 test(s) failed' };
    const ctx: NotificationContext = {
      pr: fixturePr(),
      topFailures: [
        { testCaseId: 'checkout-pay', errorMessage: 'timeout waiting for selector' },
        { testCaseId: 'checkout-cart' },
      ],
    };

    const message = buildGateMessage(decision, ctx, NOW);

    expect(message.event).toBe('gate_decision');
    expect(message.title).toBe('⛔ BLOCK — PR #482: checkout redesign');
    expect(message.summary).toBe('2 test(s) failed');
    expect(message.severity).toBe('critical');
    expect(message.details).toEqual([
      'checkout-pay — timeout waiting for selector',
      'checkout-cart',
    ]);
    expect(message.links).toEqual({ prUrl: 'https://github.com/acme/shop/pull/482' });
    expect(message.at).toEqual(NOW());
    expect(message.dedupKey).toBe('482:gate_decision');
  });

  it('maps WARN to warning severity and PASS to info severity', () => {
    const warn = buildGateMessage({ decision: 'WARN', reason: 'flaky' }, {}, NOW);
    expect(warn.severity).toBe('warning');
    expect(warn.title).toContain('⚠️');

    const pass = buildGateMessage({ decision: 'PASS', reason: 'all good' }, {}, NOW);
    expect(pass.severity).toBe('info');
    expect(pass.title).toContain('✅');
  });

  it('caps details at 5 items with a "+N more" trailer', () => {
    const topFailures = Array.from({ length: 8 }, (_, i) => ({ testCaseId: `test-${i}` }));
    const message = buildGateMessage(
      { decision: 'BLOCK', reason: '8 failed' },
      { pr: fixturePr(), topFailures },
      NOW,
    );

    expect(message.details).toHaveLength(6);
    expect(message.details.slice(0, 5)).toEqual(['test-0', 'test-1', 'test-2', 'test-3', 'test-4']);
    expect(message.details[5]).toBe('+3 more, see the PR');
  });

  it('omits dashboardExecutionUrl and prUrl when no PR/dashboard link was cached', () => {
    const message = buildGateMessage({ decision: 'PASS', reason: 'ok' }, {}, NOW);
    expect(message.links).toEqual({});
    expect(message.links.dashboardExecutionUrl).toBeUndefined();
    expect(message.dedupKey).toBeUndefined();
  });

  it('includes the dashboardExecutionUrl when configured', () => {
    const message = buildGateMessage(
      { decision: 'WARN', reason: 'flaky' },
      { pr: fixturePr(), dashboardExecutionUrl: 'https://qa.example.com/executions/exec-1' },
      NOW,
    );
    expect(message.links.dashboardExecutionUrl).toBe('https://qa.example.com/executions/exec-1');
  });
});

describe('buildBugMessage', () => {
  function fixtureFinding(overrides: Partial<ExploratoryFinding> = {}): ExploratoryFinding {
    return {
      title: 'Payment fails for Visa 4242',
      severity: 'CRITICAL',
      steps: ['Add to cart', 'Checkout', 'Enter Visa 4242', 'Submit'],
      expected: 'Payment confirmed',
      actual: 'Error processing payment',
      ...overrides,
    };
  }

  it('composes a bug message with severity, expected/actual, and capped repro steps', () => {
    const bug = fixtureFinding();
    const message = buildBugMessage(bug, { pr: fixturePr() }, NOW);

    expect(message.event).toBe('bug_found');
    expect(message.title).toBe(
      '🐛 CRITICAL — Payment fails for Visa 4242 (PR #482: checkout redesign)',
    );
    expect(message.summary).toBe('expected: Payment confirmed — actual: Error processing payment');
    expect(message.severity).toBe('critical');
    expect(message.details).toEqual(bug.steps);
    expect(message.dedupKey).toBe('482:bug_found');
  });

  it('maps MEDIUM to warning and LOW to info severity', () => {
    const medium = buildBugMessage(fixtureFinding({ severity: 'MEDIUM' }), {}, NOW);
    expect(medium.severity).toBe('warning');

    const low = buildBugMessage(fixtureFinding({ severity: 'LOW' }), {}, NOW);
    expect(low.severity).toBe('info');
  });

  it('caps repro steps at 5 with a trailer', () => {
    const steps = Array.from({ length: 7 }, (_, i) => `step-${i}`);
    const message = buildBugMessage(fixtureFinding({ steps }), {}, NOW);
    expect(message.details).toHaveLength(6);
    expect(message.details[5]).toBe('+2 more, see the PR');
  });

  it('omits the PR suffix and links when no PR was cached', () => {
    const message = buildBugMessage(fixtureFinding(), {}, NOW);
    expect(message.title).toBe('🐛 CRITICAL — Payment fails for Visa 4242');
    expect(message.links).toEqual({});
  });
});
