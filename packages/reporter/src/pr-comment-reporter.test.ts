import { describe, expect, it, vi } from 'vitest';
import { defineConfig, WardenError } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { PrCommentReporter } from './pr-comment-reporter.js';

function makeMockOctokit() {
  return {
    issues: {
      createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    },
  };
}

describe('PrCommentReporter', () => {
  it('posts renderPrReport markdown as an issue comment', async () => {
    const octokit = makeMockOctokit();
    const reporter = new PrCommentReporter(octokit);
    const execution = fixtureExecution();

    await reporter.report(execution, {
      config: defineConfig(),
      artifactsDir: '/tmp/artifacts',
      prNumber: 482,
      repo: { owner: 'acme', repo: 'checkout' },
    });

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const call = octokit.issues.createComment.mock.calls[0]?.[0];
    expect(call).toMatchObject({ owner: 'acme', repo: 'checkout', issue_number: 482 });
    expect(call.body).toContain('Warden QA Report');
    expect(call.body).toContain('TC-042');
  });

  it('throws a WardenError when prNumber is missing', async () => {
    const octokit = makeMockOctokit();
    const reporter = new PrCommentReporter(octokit);
    const execution = fixtureExecution();

    await expect(
      reporter.report(execution, {
        config: defineConfig(),
        artifactsDir: '/tmp/artifacts',
        repo: { owner: 'acme', repo: 'checkout' },
      }),
    ).rejects.toThrow(WardenError);
    expect(octokit.issues.createComment).not.toHaveBeenCalled();
  });

  it('throws a WardenError when repo is missing', async () => {
    const octokit = makeMockOctokit();
    const reporter = new PrCommentReporter(octokit);
    const execution = fixtureExecution();

    await expect(
      reporter.report(execution, {
        config: defineConfig(),
        artifactsDir: '/tmp/artifacts',
        prNumber: 482,
      }),
    ).rejects.toThrow(WardenError);
  });
});
