import { describe, expect, it } from 'vitest';
import { WardenError, defineConfig, type ReportContext } from '@warden/core';
import { createFakeVcsProvider, fixtureExecution } from '@warden/core/testing';
import { VcsCommentReporter } from './vcs-comment-reporter.js';

function ctx(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    config: defineConfig(),
    artifactsDir: '/artifacts',
    prNumber: 42,
    repo: { owner: 'acme', repo: 'checkout' },
    ...overrides,
  };
}

describe('VcsCommentReporter', () => {
  it('posts the PR report via provider.postComment', async () => {
    const fake = createFakeVcsProvider({ host: 'gitlab' });
    await new VcsCommentReporter(fake).report(fixtureExecution(), ctx());

    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0]!.prNumber).toBe(42);
    expect(fake.comments[0]!.repo).toMatchObject({
      host: 'gitlab',
      owner: 'acme',
      repo: 'checkout',
    });
    expect(fake.comments[0]!.body).toContain('Warden QA Report');
  });

  it('prefers ctx.repo.host and threads the Azure DevOps project', async () => {
    const fake = createFakeVcsProvider({ host: 'github' });
    await new VcsCommentReporter(fake).report(
      fixtureExecution(),
      ctx({ repo: { owner: 'org', repo: 'checkout', host: 'azure-devops', project: 'proj' } }),
    );

    expect(fake.comments[0]!.repo).toEqual({
      host: 'azure-devops',
      owner: 'org',
      repo: 'checkout',
      project: 'proj',
    });
  });

  it('throws when ctx.prNumber is missing', async () => {
    const fake = createFakeVcsProvider();
    await expect(
      new VcsCommentReporter(fake).report(fixtureExecution(), ctx({ prNumber: undefined })),
    ).rejects.toThrow(WardenError);
  });
});
