import { describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@warden/core';
import { createFakeVcsProvider } from '@warden/core/testing';
import { createReporters } from './create-reporters.js';

function mockOctokit() {
  return {
    issues: { createComment: vi.fn().mockResolvedValue({}) },
    checks: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe('createReporters', () => {
  it('returns only the ctrf reporter when only ctrf is enabled', () => {
    const cfg = defineConfig({
      reporting: {
        ctrf: true,
        githubJobSummary: false,
        prComment: false,
        checkRunAnnotations: false,
      },
    });

    const reporters = createReporters(cfg);

    expect(reporters.map((r) => r.name)).toEqual(['ctrf']);
  });

  it('returns all four reporters when all flags are enabled and octokit is supplied', () => {
    const cfg = defineConfig({
      reporting: { ctrf: true, githubJobSummary: true, prComment: true, checkRunAnnotations: true },
    });

    const reporters = createReporters(cfg, {
      octokit: mockOctokit(),
      jobSummaryPath: '/tmp/summary.md',
    });

    expect(reporters.map((r) => r.name).sort()).toEqual(
      ['check-run', 'ctrf', 'github-job-summary', 'pr-comment'].sort(),
    );
  });

  it('selects the Vcs reporters when deps.vcs is provided (no octokit needed)', () => {
    const cfg = defineConfig({
      reporting: {
        ctrf: false,
        githubJobSummary: false,
        prComment: true,
        checkRunAnnotations: true,
      },
    });

    const reporters = createReporters(cfg, { vcs: createFakeVcsProvider({ host: 'gitlab' }) });

    expect(reporters.map((r) => r.name).sort()).toEqual(['vcs-check', 'vcs-comment']);
  });

  it('prefers Vcs reporters over the Octokit ones when both deps are present', () => {
    const cfg = defineConfig({
      reporting: {
        ctrf: false,
        githubJobSummary: false,
        prComment: true,
        checkRunAnnotations: true,
      },
    });

    const reporters = createReporters(cfg, {
      vcs: createFakeVcsProvider(),
      octokit: mockOctokit(),
    });

    expect(reporters.map((r) => r.name).sort()).toEqual(['vcs-check', 'vcs-comment']);
  });

  it('skips the PR comment (with a warning) when enabled but no client is provided — a local run', () => {
    const cfg = defineConfig({
      reporting: {
        ctrf: false,
        githubJobSummary: false,
        prComment: true,
        checkRunAnnotations: false,
      },
    });
    const warnings: string[] = [];

    const reporters = createReporters(cfg, { logger: { warn: (m) => warnings.push(m) } });

    expect(reporters).toEqual([]);
    expect(warnings.join(' ')).toContain('PR comment');
  });

  it('skips the check run (with a warning) when enabled but no client is provided', () => {
    const cfg = defineConfig({
      reporting: {
        ctrf: false,
        githubJobSummary: false,
        prComment: false,
        checkRunAnnotations: true,
      },
    });
    const warnings: string[] = [];

    const reporters = createReporters(cfg, { logger: { warn: (m) => warnings.push(m) } });

    expect(reporters).toEqual([]);
    expect(warnings.join(' ')).toContain('check run');
  });

  it('returns an empty list when every flag is disabled', () => {
    const cfg = defineConfig({
      reporting: {
        ctrf: false,
        githubJobSummary: false,
        prComment: false,
        checkRunAnnotations: false,
      },
    });

    expect(createReporters(cfg)).toEqual([]);
  });
});
