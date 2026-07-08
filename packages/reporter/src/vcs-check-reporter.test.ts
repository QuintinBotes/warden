import { describe, expect, it } from 'vitest';
import { WardenError, defineConfig, type ReportContext } from '@warden/core';
import { createFakeVcsProvider, fixtureExecution } from '@warden/core/testing';
import { VcsCheckReporter } from './vcs-check-reporter.js';

function ctx(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    config: defineConfig(),
    artifactsDir: '/artifacts',
    headSha: 'abc123',
    repo: { owner: 'acme', repo: 'checkout' },
    ...overrides,
  };
}

describe('VcsCheckReporter', () => {
  it('posts a success status when all tests pass', async () => {
    const fake = createFakeVcsProvider({ host: 'bitbucket' });
    await new VcsCheckReporter(fake).report(fixtureExecution(), ctx());

    expect(fake.statuses).toHaveLength(1);
    expect(fake.statuses[0]).toMatchObject({
      repo: { host: 'bitbucket', owner: 'acme', repo: 'checkout' },
      headSha: 'abc123',
      status: { context: 'warden-qa', state: 'success', title: 'Warden QA Report' },
    });
  });

  it('posts a failure status when a test failed', async () => {
    const fake = createFakeVcsProvider({ host: 'gitlab' });
    const execution = fixtureExecution({
      results: [{ testCaseId: 'TC-1', status: 'FAIL', duration: 5, retries: 0, flakeFlag: false }],
    });

    await new VcsCheckReporter(fake).report(execution, ctx());

    expect(fake.statuses[0]!.status.state).toBe('failure');
  });

  it('posts a neutral status when a test is flaky', async () => {
    const fake = createFakeVcsProvider();
    const execution = fixtureExecution({
      results: [{ testCaseId: 'TC-1', status: 'FLAKY', duration: 5, retries: 1, flakeFlag: true }],
    });

    await new VcsCheckReporter(fake).report(execution, ctx());

    expect(fake.statuses[0]!.status.state).toBe('neutral');
  });

  it('throws when ctx.headSha is missing', async () => {
    const fake = createFakeVcsProvider();
    await expect(
      new VcsCheckReporter(fake).report(fixtureExecution(), ctx({ headSha: undefined })),
    ).rejects.toThrow(WardenError);
  });
});
