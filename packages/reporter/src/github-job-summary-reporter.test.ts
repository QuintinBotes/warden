import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineConfig, WardenError } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { GithubJobSummaryReporter } from './github-job-summary-reporter.js';

describe('GithubJobSummaryReporter', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-summary-'));
    filePath = path.join(dir, 'summary.md');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes Markdown to the injected file path', async () => {
    const reporter = new GithubJobSummaryReporter({ filePath });
    const execution = fixtureExecution();

    await reporter.report(execution, { config: defineConfig(), artifactsDir: dir });

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('Warden QA Report');
    expect(content).toContain('TC-042');
  });

  it('appends across multiple report() calls', async () => {
    const reporter = new GithubJobSummaryReporter({ filePath });
    const execution = fixtureExecution();

    await reporter.report(execution, { config: defineConfig(), artifactsDir: dir });
    await reporter.report(execution, { config: defineConfig(), artifactsDir: dir });

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content.match(/Warden QA Report/g)).toHaveLength(2);
  });

  it('throws a WardenError when no path is available', async () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    const reporter = new GithubJobSummaryReporter();
    const execution = fixtureExecution();

    await expect(
      reporter.report(execution, { config: defineConfig(), artifactsDir: dir }),
    ).rejects.toThrow(WardenError);
  });
});
