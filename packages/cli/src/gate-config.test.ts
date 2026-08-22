import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig, type CTRFReport, type CTRFTest } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { evaluateExitCriteria } from '@warden/orchestrator';
import { computeGateDecision, executionToCtrf } from '@warden/reporter';
import { ctrfToExecution } from './ctrf-execution';
import { runReport } from './run-report';
import { runRun } from './run-run';

/**
 * The merge gate is configured by `gates.*` in `warden.config.ts`. These tests drive the real
 * `runRun` end to end — the same call path `warden run` uses — because the defect they guard
 * against was precisely that the gate the CLI runs read no configuration at all.
 */

/** Builds a CTRF report from `[status, priority?]` pairs, with a consistent summary. */
function ctrf(tests: Array<Partial<CTRFTest> & { status: CTRFTest['status'] }>): CTRFReport {
  const full: CTRFTest[] = tests.map((t, i) => ({
    name: t.name ?? `test ${i}`,
    status: t.status,
    duration: 1,
    ...(t.extra ? { extra: t.extra } : {}),
    ...(t.tags ? { tags: t.tags } : {}),
  }));
  const count = (s: CTRFTest['status']) => full.filter((t) => t.status === s).length;
  return {
    results: {
      tool: { name: 'playwright' },
      summary: {
        tests: full.length,
        passed: count('passed'),
        failed: count('failed'),
        skipped: count('skipped'),
        pending: count('pending'),
        other: count('other'),
        start: 1000,
        stop: 2000,
      },
      tests: full,
    },
  };
}

/** Nine passes and one failure — a 90% pass rate. */
function ninetyPercent(): CTRFReport {
  return ctrf([
    ...Array.from({ length: 9 }, () => ({ status: 'passed' as const })),
    { name: 'boom', status: 'failed' as const },
  ]);
}

/** One pass and nine skips — a 10% pass rate, with nothing red in it. */
function mostlySkipped(): CTRFReport {
  return ctrf([
    { status: 'passed' as const },
    ...Array.from({ length: 9 }, () => ({ status: 'skipped' as const })),
  ]);
}

const quiet = {
  reporting: { ctrf: false, prComment: false, checkRunAnnotations: false, githubJobSummary: false },
};

describe('warden run honours the configured gates policy', () => {
  let artifactsDir: string;

  beforeEach(async () => {
    artifactsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-gate-config-'));
  });

  afterEach(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  it('does not BLOCK when the pass rate clears the configured floor', async () => {
    // A 10% pass rate with nothing red: under the shipped floor this blocks, and under a
    // floor the project lowered to 5% it does not. That difference is the config being read.
    const config = defineConfig({ ...quiet, gates: { blockOnPassRateBelowPercent: 5 } });

    const result = await runRun(
      { artifactsDir },
      { config, runTests: async () => mostlySkipped(), reporters: [] },
    );

    expect(result.gate.decision).not.toBe('BLOCK');

    const shipped = await runRun(
      { artifactsDir },
      { config: defineConfig(quiet), runTests: async () => mostlySkipped(), reporters: [] },
    );
    expect(shipped.gate.decision).toBe('BLOCK');
    expect(shipped.gate.reason).toMatch(/pass rate 10\.0% is below the required 90%/);
  });

  it('BLOCKs the same run under the default policy — the default gate is still fail-closed', async () => {
    const result = await runRun(
      { artifactsDir },
      { config: defineConfig(quiet), runTests: async () => ninetyPercent(), reporters: [] },
    );

    expect(result.gate.decision).toBe('BLOCK');
  });

  it('BLOCKs a P1 failure under a loosened floor when blockOnCritical is on', async () => {
    const config = defineConfig({ ...quiet, gates: { blockOnPassRateBelowPercent: 50 } });
    const report = ctrf([
      ...Array.from({ length: 9 }, () => ({ status: 'passed' as const })),
      { name: 'checkout', status: 'failed' as const, extra: { priority: 'P1' } },
    ]);

    const result = await runRun(
      { artifactsDir },
      { config, runTests: async () => report, reporters: [] },
    );

    expect(result.gate.decision).toBe('BLOCK');
    expect(result.gate.reason).toMatch(/P1/);
  });

  it('stops calling the same failure critical when blockOnCritical is turned off', async () => {
    const config = defineConfig({
      ...quiet,
      gates: { blockOnCritical: false, blockOnPassRateBelowPercent: 50 },
    });
    const report = ctrf([
      ...Array.from({ length: 9 }, () => ({ status: 'passed' as const })),
      { name: 'checkout', status: 'failed' as const, extra: { priority: 'P1' } },
    ]);

    const result = await runRun(
      { artifactsDir },
      { config, runTests: async () => report, reporters: [] },
    );

    // Turning the rule off does not let a failing test through — any failure blocks — but the
    // reason stops naming the critical rule, which is the whole effect the setting has.
    expect(result.gate.decision).toBe('BLOCK');
    expect(result.gate.reason).not.toMatch(/P1/);
  });

  it('BLOCKs when P2 failures exceed warnOnHighCount, reading priority from a @P2 tag', async () => {
    const config = defineConfig({
      ...quiet,
      gates: { blockOnPassRateBelowPercent: 50, warnOnHighCount: 2 },
    });
    const report = ctrf([
      ...Array.from({ length: 27 }, () => ({ status: 'passed' as const })),
      ...Array.from({ length: 3 }, (_, i) => ({
        name: `high ${i}`,
        status: 'failed' as const,
        tags: ['@P2'],
      })),
    ]);

    const result = await runRun(
      { artifactsDir },
      { config, runTests: async () => report, reporters: [] },
    );

    expect(result.gate.decision).toBe('BLOCK');
    expect(result.gate.reason).toMatch(/P2/);
  });
});

describe('warden report aggregate honours the same policy', () => {
  let reportsDir: string;

  beforeEach(async () => {
    reportsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-gate-agg-'));
  });

  afterEach(async () => {
    await fs.rm(reportsDir, { recursive: true, force: true });
  });

  it('reads gates from the config rather than applying a fixed rule', async () => {
    await fs.writeFile(path.join(reportsDir, 'run.json'), JSON.stringify(mostlySkipped()), 'utf-8');
    const octokit = {
      issues: { createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
      checks: { create: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
    };

    const result = await runReport(
      { reports: reportsDir, pr: 7 },
      {
        config: defineConfig({ gates: { blockOnPassRateBelowPercent: 5 } }),
        octokit,
        repo: { owner: 'acme', repo: 'checkout' },
      },
    );

    // The shipped floor would block this run at 10%; the lowered one does not.
    expect(result.gate.decision).not.toBe('BLOCK');
  });

  it('gates on a P1 written by an earlier `warden run` — priority survives the CTRF round trip', async () => {
    const report = ctrf([
      ...Array.from({ length: 9 }, () => ({ status: 'passed' as const })),
      { name: 'checkout', status: 'failed' as const, extra: { priority: 'P1' } },
    ]);
    // Round-trip it exactly as `warden run` does: CTRF -> TestExecution -> CTRF on disk.
    const roundTripped = executionToCtrf(ctrfToExecution(report));
    await fs.writeFile(path.join(reportsDir, 'run.json'), JSON.stringify(roundTripped), 'utf-8');

    const result = await runReport(
      { reports: reportsDir, pr: 7 },
      {
        config: defineConfig({ gates: { blockOnPassRateBelowPercent: 50 } }),
        octokit: {
          issues: { createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
          checks: { create: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
        },
        repo: { owner: 'acme', repo: 'checkout' },
      },
    );

    expect(result.gate.decision).toBe('BLOCK');
    expect(result.gate.reason).toMatch(/P1/);
  });
});

describe('there is one gate, reachable by two names', () => {
  // `evaluateExitCriteria` and `computeGateDecision` were two independent implementations, and
  // the one the product called was the one that read no config. They must not diverge again.
  const cases: Array<{ status: 'PASS' | 'FAIL' | 'FLAKY' | 'SKIP'; priority?: 'P1' | 'P2' }> = [
    { status: 'PASS' },
    { status: 'FAIL', priority: 'P2' },
    { status: 'FLAKY' },
    { status: 'SKIP' },
  ];

  it.each([100, 90, 50, 0])('agrees at a %i%% pass-rate floor', (floor) => {
    const config = defineConfig({ gates: { blockOnPassRateBelowPercent: floor } });
    const execution = fixtureExecution({
      results: cases.map((c, i) => ({
        testCaseId: `TC-${i}`,
        status: c.status,
        duration: 1,
        retries: 0,
        flakeFlag: c.status === 'FLAKY',
        ...(c.priority ? { priority: c.priority } : {}),
      })),
    });

    expect(computeGateDecision(execution, config.gates)).toEqual(
      evaluateExitCriteria(execution.results, config),
    );
  });
});
