import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { runAnalyze } from './run-analyze';

describe('runAnalyze', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-analyze-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('emits the three GitHub-Actions output lines from an injected surface', async () => {
    const surface = fixtureChangeSurface({
      testTags: ['@smoke', '@checkout'],
      riskScore: 5,
      hasSharedChanges: false,
    });

    const content = await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir },
      { surface, config: defineConfig() },
    );

    expect(content).toBe(
      'test_tags=@smoke @checkout\nrisk_score=5\nrun_full_suite=false\nconfigured=true\n',
    );
  });

  it('sets run_full_suite to true when the surface has shared changes', async () => {
    const surface = fixtureChangeSurface({ testTags: [], riskScore: 9, hasSharedChanges: true });

    const content = await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir },
      { surface, config: defineConfig() },
    );

    expect(content).toContain('run_full_suite=true');
  });

  it('writes the output lines to the output file when given', async () => {
    const surface = fixtureChangeSurface({ testTags: ['@api'], riskScore: 2 });
    const outputFile = path.join(dir, 'gh-output.txt');

    const content = await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir, output: outputFile },
      { surface, config: defineConfig() },
    );

    const written = await fs.readFile(outputFile, 'utf-8');
    expect(written).toBe(content);
    expect(written).toContain('test_tags=@api');
    expect(written).toContain('risk_score=2');
  });

  it('appends to an existing output file rather than clobbering it', async () => {
    const outputFile = path.join(dir, 'gh-output.txt');
    await fs.writeFile(outputFile, 'existing_key=1\n', 'utf-8');

    const surface = fixtureChangeSurface({ testTags: ['@api'], riskScore: 1 });
    await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir, output: outputFile },
      { surface, config: defineConfig() },
    );

    const written = await fs.readFile(outputFile, 'utf-8');
    expect(written).toContain('existing_key=1');
    expect(written).toContain('test_tags=@api');
  });

  it('never calls loadConfig (touches the filesystem for warden.config.*) when both surface and config are injected', async () => {
    // A non-existent cwd would make loadConfig throw if it were ever invoked.
    const bogusCwd = path.join(dir, 'does-not-exist');
    const surface = fixtureChangeSurface({ testTags: [], riskScore: 0 });

    await expect(
      runAnalyze(
        { base: 'main', head: 'feature', cwd: bogusCwd },
        { surface, config: defineConfig() },
      ),
    ).resolves.toBeTypeOf('string');
  });

  it('marks a repository with no warden.config as unconfigured, and says so once', async () => {
    // No config is injected, so the real loader runs against a directory that has none.
    const surface = fixtureChangeSurface({ testTags: [], riskScore: 3 });
    const warnings: string[] = [];

    const content = await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir },
      { surface, warn: (m) => warnings.push(m) },
    );

    expect(content).toContain('configured=false');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no warden\.config/i);
  });

  it('marks a repository that has a warden.config as configured', async () => {
    await fs.writeFile(path.join(dir, 'warden.config.ts'), 'export default {};\n', 'utf-8');
    const surface = fixtureChangeSurface({ testTags: [], riskScore: 3 });
    const warnings: string[] = [];

    const content = await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir },
      { surface, warn: (m) => warnings.push(m) },
    );

    expect(content).toContain('configured=true');
  });

  it("reports the surface's scope warning instead of emitting a bare test_tags= line", async () => {
    const warnings: string[] = [];
    const surface = fixtureChangeSurface({
      testTags: [],
      scopeWarning: 'No changed file is under any scope.modulePaths prefix (apps/).',
    });

    const content = await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir },
      { surface, config: defineConfig(), warn: (msg) => warnings.push(msg) },
    );

    // The machine-readable output is unchanged — the warning is for the human reading the log.
    expect(content).toContain('test_tags=\n');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('scope.modulePaths');
  });

  it('stays quiet when the surface scoped cleanly', async () => {
    const warnings: string[] = [];
    await runAnalyze(
      { base: 'main', head: 'feature', cwd: dir },
      {
        surface: fixtureChangeSurface({ testTags: ['@apps/checkout'] }),
        config: defineConfig(),
        warn: (msg) => warnings.push(msg),
      },
    );
    expect(warnings).toEqual([]);
  });
});
