import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { CtrfReporter } from './ctrf-reporter.js';

describe('CtrfReporter', () => {
  let artifactsDir: string;

  beforeEach(async () => {
    artifactsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-ctrf-'));
  });

  afterEach(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  it('writes a CTRFReportSchema-valid ctrf-report.json into ctx.artifactsDir', async () => {
    const reporter = new CtrfReporter();
    const execution = fixtureExecution();

    await reporter.report(execution, {
      config: defineConfig(),
      artifactsDir,
    });

    const raw = await fs.readFile(path.join(artifactsDir, 'ctrf-report.json'), 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.results.tool.name).toBe('warden');
    expect(parsed.results.tests[0].name).toBe('TC-042');
  });

  it('creates the artifacts directory if it does not exist yet', async () => {
    const nested = path.join(artifactsDir, 'nested', 'dir');
    const reporter = new CtrfReporter();
    const execution = fixtureExecution();

    await reporter.report(execution, { config: defineConfig(), artifactsDir: nested });

    const raw = await fs.readFile(path.join(nested, 'ctrf-report.json'), 'utf-8');
    expect(JSON.parse(raw).results.tests).toHaveLength(1);
  });
});
