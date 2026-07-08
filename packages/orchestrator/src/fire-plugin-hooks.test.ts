import { describe, expect, it } from 'vitest';
import type { GateDecision, PullRequest, QAPlatformPlugin, TestExecution } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { firePluginHooks } from './fire-plugin-hooks';

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

describe('firePluginHooks', () => {
  it('routes onPROpened to every plugin implementing it, with the exact payload', async () => {
    const seen: PullRequest[] = [];
    const plugin: QAPlatformPlugin = {
      name: 'recorder',
      async onPROpened(pr) {
        seen.push(pr);
      },
    };
    const pr = fixturePr();

    const outcomes = await firePluginHooks([plugin], { hook: 'onPROpened', pr });

    expect(seen).toEqual([pr]);
    expect(outcomes).toEqual([{ plugin: 'recorder', hook: 'onPROpened', ok: true }]);
  });

  it('routes onTestExecutionComplete with both execution and results', async () => {
    const execution = fixtureExecution();
    const seen: { execution: TestExecution; results: unknown }[] = [];
    const plugin: QAPlatformPlugin = {
      name: 'recorder',
      async onTestExecutionComplete(execution, results) {
        seen.push({ execution, results });
      },
    };

    await firePluginHooks([plugin], {
      hook: 'onTestExecutionComplete',
      execution,
      results: execution.results,
    });

    expect(seen).toEqual([{ execution, results: execution.results }]);
  });

  it('routes onGateDecision with the decision payload', async () => {
    const decision: GateDecision = { decision: 'BLOCK', reason: '1 test failed' };
    const seen: GateDecision[] = [];
    const plugin: QAPlatformPlugin = {
      name: 'recorder',
      async onGateDecision(d) {
        seen.push(d);
      },
    };

    await firePluginHooks([plugin], { hook: 'onGateDecision', decision });

    expect(seen).toEqual([decision]);
  });

  it('runs every plugin in parallel and marks ok:true for a plugin with no matching handler', async () => {
    const order: string[] = [];
    const withHandler: QAPlatformPlugin = {
      name: 'with-handler',
      async onPROpened() {
        order.push('with-handler');
      },
    };
    const withoutHandler: QAPlatformPlugin = { name: 'without-handler' };

    const outcomes = await firePluginHooks([withHandler, withoutHandler], {
      hook: 'onPROpened',
      pr: fixturePr(),
    });

    expect(order).toEqual(['with-handler']);
    expect(outcomes).toEqual([
      { plugin: 'with-handler', hook: 'onPROpened', ok: true },
      { plugin: 'without-handler', hook: 'onPROpened', ok: true },
    ]);
  });

  it('captures a throwing plugin as ok:false without affecting its siblings or throwing to the caller', async () => {
    const seen: string[] = [];
    const throwing: QAPlatformPlugin = {
      name: 'throws',
      async onPROpened() {
        throw new Error('bad webhook url');
      },
    };
    const healthy: QAPlatformPlugin = {
      name: 'healthy',
      async onPROpened() {
        seen.push('healthy');
      },
    };

    const outcomes = await firePluginHooks([throwing, healthy], {
      hook: 'onPROpened',
      pr: fixturePr(),
    });

    expect(seen).toEqual(['healthy']);
    expect(outcomes).toContainEqual({
      plugin: 'throws',
      hook: 'onPROpened',
      ok: false,
      error: 'bad webhook url',
    });
    expect(outcomes).toContainEqual({ plugin: 'healthy', hook: 'onPROpened', ok: true });
  });

  it('captures a rejecting plugin as ok:false', async () => {
    const rejecting: QAPlatformPlugin = {
      name: 'rejects',
      onGateDecision: () => Promise.reject(new Error('network timeout')),
    };

    const outcomes = await firePluginHooks([rejecting], {
      hook: 'onGateDecision',
      decision: { decision: 'WARN', reason: 'flaky test' },
    });

    expect(outcomes).toEqual([
      { plugin: 'rejects', hook: 'onGateDecision', ok: false, error: 'network timeout' },
    ]);
  });
});
