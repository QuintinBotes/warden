import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineConfig, type CTRFReport } from '@warden/core';
import { fakeReporter } from '@warden/core/testing';
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
});
