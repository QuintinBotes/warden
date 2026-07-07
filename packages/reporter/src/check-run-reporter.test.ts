import { describe, expect, it, vi } from 'vitest';
import { defineConfig, WardenError } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { CheckRunReporter } from './check-run-reporter.js';

function makeMockOctokit() {
  return {
    checks: {
      create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    },
  };
}

describe('CheckRunReporter', () => {
  it('creates a check run with a summary and no annotations when everything passed', async () => {
    const octokit = makeMockOctokit();
    const reporter = new CheckRunReporter(octokit);
    const execution = fixtureExecution();

    await reporter.report(execution, {
      config: defineConfig(),
      artifactsDir: '/tmp/artifacts',
      headSha: 'abc123',
      repo: { owner: 'acme', repo: 'checkout' },
    });

    expect(octokit.checks.create).toHaveBeenCalledTimes(1);
    const call = octokit.checks.create.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      owner: 'acme',
      repo: 'checkout',
      head_sha: 'abc123',
      status: 'completed',
      conclusion: 'success',
    });
    expect(call.output.summary).toContain('Warden QA Report');
    expect(call.output.annotations ?? []).toHaveLength(0);
  });

  it('maps failed results to annotations and sets conclusion failure', async () => {
    const octokit = makeMockOctokit();
    const reporter = new CheckRunReporter(octokit);
    const execution = fixtureExecution({
      results: [
        {
          testCaseId: 'TC-1',
          status: 'FAIL',
          duration: 120,
          retries: 0,
          flakeFlag: false,
          errorMessage: 'expected 200 got 500',
          tracePath: 'traces/tc-1.zip',
        },
      ],
    });

    await reporter.report(execution, {
      config: defineConfig(),
      artifactsDir: '/tmp/artifacts',
      headSha: 'def456',
      repo: { owner: 'acme', repo: 'checkout' },
    });

    const call = octokit.checks.create.mock.calls[0]?.[0];
    expect(call.conclusion).toBe('failure');
    expect(call.output.annotations).toEqual([
      {
        path: 'traces/tc-1.zip',
        start_line: 1,
        end_line: 1,
        annotation_level: 'failure',
        message: 'expected 200 got 500',
        title: 'TC-1',
      },
    ]);
  });

  it('throws a WardenError when repo or headSha is missing', async () => {
    const octokit = makeMockOctokit();
    const reporter = new CheckRunReporter(octokit);
    const execution = fixtureExecution();

    await expect(
      reporter.report(execution, { config: defineConfig(), artifactsDir: '/tmp/artifacts' }),
    ).rejects.toThrow(WardenError);
    expect(octokit.checks.create).not.toHaveBeenCalled();
  });
});
