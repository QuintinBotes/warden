import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contentId,
  defineConfig,
  type CTRFReport,
  type CTRFTest,
  type FlakeClassification,
  type FlakeClassifier,
  type GateDecision,
  type QAPlatformPlugin,
  type TestExecution,
  type TestResult,
} from '@warden/core';
import { fakeReporter } from '@warden/core/testing';
import { SqliteStore } from '@warden/test-management';
import { runRun } from './run-run';

function fixtureCtrf(): CTRFReport {
  return {
    results: {
      tool: { name: 'playwright' },
      summary: {
        tests: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 1000,
        stop: 2000,
      },
      tests: [
        { name: 'smoke: home page loads', status: 'passed', duration: 100 },
        { name: 'smoke: checkout fails', status: 'failed', duration: 200, message: 'boom' },
      ],
    },
  };
}

describe('runRun', () => {
  let artifactsDir: string;

  beforeEach(async () => {
    artifactsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-run-'));
  });

  afterEach(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  it('wires the injected runner, writes the CTRF file, and invokes injected reporters', async () => {
    const report = fixtureCtrf();
    const calls: Array<{ grep?: string; cwd?: string }> = [];
    const reporter = fakeReporter();

    const result = await runRun(
      { grep: '@smoke', artifactsDir },
      {
        config: defineConfig(),
        runTests: async (runOpts) => {
          calls.push(runOpts);
          return report;
        },
        reporters: [reporter],
      },
    );

    expect(calls).toEqual([{ grep: '@smoke', cwd: process.cwd() }]);

    const ctrfOnDisk = JSON.parse(await fs.readFile(result.ctrfPath, 'utf-8'));
    expect(ctrfOnDisk).toEqual(report);

    expect(reporter.reported).toHaveLength(1);
    expect(reporter.reported[0]?.results).toHaveLength(2);
    expect(reporter.reported[0]?.results.map((r) => r.status)).toEqual(['PASS', 'FAIL']);
  });

  it('returns the derived execution alongside the raw report', async () => {
    const report = fixtureCtrf();

    const result = await runRun(
      { artifactsDir },
      {
        config: defineConfig(),
        runTests: async () => report,
        reporters: [],
      },
    );

    expect(result.report).toEqual(report);
    expect(result.execution.results).toHaveLength(2);
    expect(result.execution.triggerType).toBe('manual');
  });

  it('creates the artifacts directory if it does not exist yet', async () => {
    const nested = path.join(artifactsDir, 'nested', 'dir');
    const report = fixtureCtrf();

    await runRun(
      { artifactsDir: nested },
      { config: defineConfig(), runTests: async () => report, reporters: [] },
    );

    const files = await fs.readdir(nested);
    expect(files).toContain('ctrf-report.json');
  });

  it('fires onTestExecutionComplete and onGateDecision on every configured plugin', async () => {
    const report = fixtureCtrf();
    const executions: { execution: TestExecution; results: unknown }[] = [];
    const decisions: GateDecision[] = [];
    const plugin: QAPlatformPlugin = {
      name: 'recorder',
      async onTestExecutionComplete(execution, results) {
        executions.push({ execution, results });
      },
      async onGateDecision(decision) {
        decisions.push(decision);
      },
    };

    const result = await runRun(
      { artifactsDir },
      {
        config: defineConfig({ plugins: [plugin] }),
        runTests: async () => report,
        reporters: [],
      },
    );

    expect(executions).toHaveLength(1);
    expect(executions[0]?.execution.results).toHaveLength(2);
    expect(decisions).toEqual([result.gate]);
    expect(result.gate.decision).toBe('BLOCK');
    expect(result.gate.reason).toContain('1 test(s) failed');
  });
});

describe('runRun flake intelligence', () => {
  const CHECKOUT_ID = contentId('TC', 'checkout.spec.ts::checkout');
  let artifactsDir: string;
  let dbDir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    artifactsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-flake-'));
    dbDir = mkdtempSync(join(tmpdir(), 'warden-cli-flake-db-'));
    store = new SqliteStore(join(dbDir, 'warden.db'));
  });

  afterEach(async () => {
    store.close();
    await fs.rm(artifactsDir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  function report(tests: CTRFTest[], start = 5000, stop = 6000): CTRFReport {
    return {
      results: {
        tool: { name: 'playwright' },
        summary: {
          tests: tests.length,
          passed: tests.filter((t) => t.status === 'passed').length,
          failed: tests.filter((t) => t.status === 'failed').length,
          skipped: 0,
          pending: 0,
          other: 0,
          start,
          stop,
        },
        tests,
      },
    };
  }

  const home: CTRFTest = { name: 'home', status: 'passed', duration: 10, filePath: 'home.spec.ts' };
  const checkoutFail: CTRFTest = {
    name: 'checkout',
    status: 'failed',
    duration: 20,
    message: 'Timeout waiting for redirect',
    filePath: 'checkout.spec.ts',
  };
  const checkoutPass: CTRFTest = {
    name: 'checkout',
    status: 'passed',
    duration: 15,
    filePath: 'checkout.spec.ts',
  };

  /** A runner that returns successive scripted reports, recording each grep it was called with. */
  function scriptedRunner(reports: CTRFReport[]) {
    const calls: Array<{ grep?: string; cwd?: string }> = [];
    let i = 0;
    return {
      calls,
      run: async (o: { grep?: string; cwd?: string }) => {
        calls.push(o);
        return reports[Math.min(i++, reports.length - 1)]!;
      },
    };
  }

  function fakeClassifier(): FlakeClassifier {
    return {
      async classify(input) {
        return {
          testCaseId: input.testCaseId,
          rootCause: 'timing',
          confidence: 0.9,
          explanation: 'timeout',
          classifiedAt: new Date('2026-07-07T12:00:00.000Z'),
        };
      },
    };
  }

  function pastExecution(id: string, status: TestResult['status'], startedAt: Date): void {
    store.saveExecution({
      id,
      testPlanId: 'PLAN-1',
      triggerType: 'schedule',
      triggerRef: 'nightly',
      environment: 'ci',
      startedAt,
      results: [
        {
          testCaseId: CHECKOUT_ID,
          status,
          duration: 100,
          retries: 0,
          flakeFlag: false,
          artifacts: [],
        },
      ],
    });
  }

  it('retries a failing test, marks it flaky, classifies it, and warns on new quarantine', async () => {
    // Prior clean history: not yet quarantined.
    pastExecution('EXEC-A', 'PASS', new Date('2026-07-01T00:00:00.000Z'));
    pastExecution('EXEC-B', 'PASS', new Date('2026-07-02T00:00:00.000Z'));

    const runner = scriptedRunner([report([home, checkoutFail]), report([checkoutPass])]);
    const classifications: FlakeClassification[] = [];

    const result = await runRun(
      { grep: '@smoke', artifactsDir },
      {
        config: defineConfig({ flake: { gate: { warnOnNewlyQuarantinedAbove: 0 } } }),
        runTests: runner.run,
        reporters: [],
        store,
        classifier: fakeClassifier(),
        metricsEmitter: {
          async emitExecution() {},
          async emitGate() {},
          async emitFlakeClassification(c) {
            classifications.push(c);
          },
        },
        sleep: async () => {},
      },
    );

    // one first run + one retry round
    expect(runner.calls).toHaveLength(2);

    const checkout = result.execution.results.find((r) => r.testCaseId === CHECKOUT_ID);
    expect(checkout?.status).toBe('FLAKY');
    expect(checkout?.retries).toBe(1);
    expect(checkout?.flakeFlag).toBe(true);

    // classification persisted and emitted
    const saved = store.getFlakeClassification(CHECKOUT_ID);
    expect(saved?.rootCause).toBe('timing');
    expect(classifications).toHaveLength(1);
    expect(classifications[0]?.testCaseId).toBe(CHECKOUT_ID);

    // quarantine flip recorded + warn gate
    const events = store.listQuarantineEvents(CHECKOUT_ID);
    expect(events.map((e) => e.event)).toEqual(['quarantined']);
    expect(result.gate.decision).toBe('WARN');
    expect(result.gate.reason).toContain('newly quarantined');
  });

  it('does not retry a fresh failure when retryOnlyKnownFlaky is set', async () => {
    const runner = scriptedRunner([report([home, checkoutFail])]);

    const result = await runRun(
      { artifactsDir },
      {
        config: defineConfig({ flake: { retry: { retryOnlyKnownFlaky: true } } }),
        runTests: runner.run,
        reporters: [],
        store,
        classifier: fakeClassifier(),
        sleep: async () => {},
      },
    );

    expect(runner.calls).toHaveLength(1);
    const checkout = result.execution.results.find((r) => r.testCaseId === CHECKOUT_ID);
    expect(checkout?.status).toBe('FAIL');
    expect(checkout?.retries).toBe(0);
    expect(result.gate.decision).toBe('BLOCK');
  });

  it('retries a known-flaky test even when retryOnlyKnownFlaky is set', async () => {
    // Link the test to a requirement and give it a quarantined FAIL history.
    store.saveRequirement({
      id: 'REQ-1',
      title: 'Checkout works',
      type: 'story',
      linkedTestIds: [CHECKOUT_ID],
      coverageStatus: 'NOT_TESTED',
    });
    const statuses: TestResult['status'][] = ['PASS', 'PASS', 'FAIL', 'PASS', 'FAIL'];
    statuses.forEach((s, i) =>
      pastExecution(`EXEC-${i}`, s, new Date(`2026-07-0${i + 1}T00:00:00.000Z`)),
    );

    const runner = scriptedRunner([report([checkoutFail]), report([checkoutPass])]);

    const result = await runRun(
      { artifactsDir },
      {
        config: defineConfig({ flake: { retry: { retryOnlyKnownFlaky: true } } }),
        runTests: runner.run,
        reporters: [],
        store,
        classifier: fakeClassifier(),
        sleep: async () => {},
      },
    );

    expect(runner.calls).toHaveLength(2);
    const checkout = result.execution.results.find((r) => r.testCaseId === CHECKOUT_ID);
    expect(checkout?.status).toBe('FLAKY');
    expect(checkout?.retries).toBe(1);
  });

  it('respects maxRetries and backoff for a test that fails every attempt', async () => {
    const runner = scriptedRunner([
      report([home, checkoutFail]),
      report([checkoutFail]),
      report([checkoutFail]),
    ]);
    const delays: number[] = [];

    const result = await runRun(
      { artifactsDir },
      {
        config: defineConfig({
          flake: { retry: { maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 } },
        }),
        runTests: runner.run,
        reporters: [],
        store,
        classifier: fakeClassifier(),
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    // 1 first run + 2 retries = 3 calls; 2 backoff sleeps at 1000ms and 2000ms
    expect(runner.calls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);

    const checkout = result.execution.results.find((r) => r.testCaseId === CHECKOUT_ID);
    expect(checkout?.status).toBe('FAIL');
    expect(checkout?.retries).toBe(2);
    expect(checkout?.flakeFlag).toBe(false);
    expect(result.gate.decision).toBe('BLOCK');
  });
});
