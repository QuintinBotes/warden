import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  defineConfig,
  type CTRFReport,
  type LogEntry,
  type TestResult,
  type WardenConfig,
} from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import type { CujSource, ExecutionHistory } from '@warden/cuj';
import { evaluateCujGateForRun } from './cuj-gate';
import { runRun } from './run-run';

const CHECKOUT_DEF = JSON.stringify({
  id: 'CUJ-checkout',
  name: 'Guest checkout',
  owningTeam: 'payments',
  tier: 'tier1',
  tags: ['@apps/checkout'],
  steps: [{ order: 1, name: 'Pay', module: '@apps/checkout', testIds: ['TC-pay'] }],
});

function memSource(files: Record<string, string>): CujSource {
  const paths = Object.keys(files);
  return {
    async list() {
      return paths;
    },
    async read(p: string) {
      return files[p]!;
    },
  };
}

function fakeHistory(byRef: Record<string, TestResult[]>): ExecutionHistory {
  return {
    async latestForRef(ref, testIds) {
      const wanted = new Set(testIds);
      return (byRef[ref] ?? []).filter((r) => wanted.has(r.testCaseId));
    },
  };
}

const result = (testCaseId: string, status: TestResult['status']): TestResult => ({
  testCaseId,
  status,
  duration: 10,
  retries: 0,
  flakeFlag: false,
  artifacts: [],
});

const enabledCfg = (): WardenConfig => defineConfig({ cuj: { enabled: true } });
const surface = () => fixtureChangeSurface({ testTags: ['@apps/checkout'], changedModules: [] });

describe('evaluateCujGateForRun', () => {
  it('is a neutral PASS when the feature is disabled', async () => {
    const outcome = await evaluateCujGateForRun([result('TC-pay', 'FAIL')], defineConfig(), {
      source: memSource({ 'checkout.yaml': CHECKOUT_DEF }),
      changeSurface: surface(),
    });
    expect(outcome.gate.decision).toBe('PASS');
    expect(outcome.reports).toEqual([]);
  });

  it('BLOCKs a tier-1 journey that regressed HEALTHY -> BROKEN vs the base ref', async () => {
    const outcome = await evaluateCujGateForRun([result('TC-pay', 'FAIL')], enabledCfg(), {
      source: memSource({ 'checkout.yaml': CHECKOUT_DEF }),
      changeSurface: surface(),
      history: fakeHistory({ main: [result('TC-pay', 'PASS')] }),
      baseRef: 'main',
    });
    expect(outcome.gate.decision).toBe('BLOCK');
    expect(outcome.gate.reason).toContain('Guest checkout');
    expect(outcome.reports[0]!.status).toBe('BROKEN');
  });

  it('WARNs when the gate is enabled but no CUJ definitions loaded', async () => {
    const outcome = await evaluateCujGateForRun([result('TC-pay', 'PASS')], enabledCfg(), {
      source: memSource({}),
      changeSurface: surface(),
    });
    expect(outcome.gate.decision).toBe('WARN');
    expect(outcome.gate.reason).toMatch(/no CUJ definitions/i);
  });

  it('is a neutral PASS when the change touches no journey', async () => {
    const outcome = await evaluateCujGateForRun([result('TC-pay', 'FAIL')], enabledCfg(), {
      source: memSource({ 'checkout.yaml': CHECKOUT_DEF }),
      changeSurface: fixtureChangeSurface({ testTags: ['@apps/search'], changedModules: [] }),
    });
    expect(outcome.gate.decision).toBe('PASS');
  });

  it('skips a malformed CUJ def with a WARN and never crashes', async () => {
    const entries: LogEntry[] = [];
    const logger = createLogger({ level: 'warn', sink: (e) => entries.push(e) });
    const outcome = await evaluateCujGateForRun(
      [result('TC-pay', 'FAIL')],
      enabledCfg(),
      {
        source: memSource({
          'checkout.yaml': CHECKOUT_DEF,
          'bad.yaml': JSON.stringify({ name: 'no id' }),
        }),
        changeSurface: surface(),
        history: fakeHistory({ main: [result('TC-pay', 'PASS')] }),
        baseRef: 'main',
      },
      logger,
    );
    // the valid journey still gates
    expect(outcome.gate.decision).toBe('BLOCK');
    expect(entries.some((e) => e.level === 'warn' && e.message.includes('skipped'))).toBe(true);
  });
});

describe('runRun folds the CUJ gate into the final decision', () => {
  let artifactsDir: string;

  beforeEach(async () => {
    artifactsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-cuj-'));
  });
  afterEach(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  const allPassCtrf = (): CTRFReport => ({
    results: {
      tool: { name: 'playwright' },
      summary: {
        tests: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 1,
      },
      tests: [{ name: 'checkout works', status: 'passed', duration: 10 }],
    },
  });

  it('makes an otherwise-PASS run WARN when a touched journey degrades on a failing signal', async () => {
    const runResult = await runRun(
      { grep: '@apps/checkout', artifactsDir },
      {
        config: enabledCfg(),
        runTests: async () => allPassCtrf(),
        reporters: [],
        cuj: {
          source: memSource({ 'checkout.yaml': CHECKOUT_DEF }),
          changeSurface: surface(),
          // No baseline; an evaluated failing perf signal degrades the journey → WARN.
          signalsByCuj: { 'CUJ-checkout': [{ kind: 'perf', value: 999, passed: false }] },
        },
      },
    );

    expect(runResult.gate.decision).toBe('WARN');
    expect(runResult.cujReports).toBeDefined();
    expect(runResult.cujReports![0]!.status).toBe('DEGRADED');
  });

  it('behaves exactly as before when no cuj collaborator is injected', async () => {
    const runResult = await runRun(
      { grep: '@apps/checkout', artifactsDir },
      { config: enabledCfg(), runTests: async () => allPassCtrf(), reporters: [] },
    );
    expect(runResult.cujReports).toBeUndefined();
    expect(runResult.gate.decision).toBe('PASS');
  });
});
