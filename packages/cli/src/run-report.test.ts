import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WardenError } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { executionToCtrf } from '@warden/reporter';
import { runReport } from './run-report';

function makeMockOctokit() {
  return {
    issues: { createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
    checks: { create: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
  };
}

describe('runReport', () => {
  let reportsDir: string;

  beforeEach(async () => {
    reportsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-report-'));

    const smoke = executionToCtrf(
      fixtureExecution({
        results: [
          { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        ],
      }),
    );
    const regression = executionToCtrf(
      fixtureExecution({
        results: [
          { testCaseId: 'TC-2', status: 'PASS', duration: 20, retries: 0, flakeFlag: false },
        ],
      }),
    );
    await fs.writeFile(path.join(reportsDir, 'smoke.json'), JSON.stringify(smoke), 'utf-8');
    await fs.writeFile(
      path.join(reportsDir, 'regression.json'),
      JSON.stringify(regression),
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(reportsDir, { recursive: true, force: true });
  });

  it('aggregates the CTRF reports and posts a gate comment via the injected octokit', async () => {
    const octokit = makeMockOctokit();

    const result = await runReport(
      { reports: reportsDir, pr: 482 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' } },
    );

    expect(result.report.results.summary.tests).toBe(2);
    expect(result.gate.decision).toBe('PASS');

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    const call = octokit.issues.createComment.mock.calls[0]?.[0];
    expect(call).toMatchObject({ owner: 'acme', repo: 'checkout', issue_number: 482 });
    expect(call.body).toContain('Warden QA Report');
  });

  it('computes a BLOCK gate decision when any aggregated test failed', async () => {
    await fs.writeFile(
      path.join(reportsDir, 'failing.json'),
      JSON.stringify(
        executionToCtrf(
          fixtureExecution({
            results: [
              { testCaseId: 'TC-3', status: 'FAIL', duration: 5, retries: 0, flakeFlag: false },
            ],
          }),
        ),
      ),
      'utf-8',
    );
    const octokit = makeMockOctokit();

    const result = await runReport(
      { reports: reportsDir, pr: 1 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' } },
    );

    expect(result.gate.decision).toBe('BLOCK');
  });

  it('uses an injected aggregate function instead of reading the filesystem', async () => {
    const octokit = makeMockOctokit();
    const customReport = executionToCtrf(fixtureExecution());
    const aggregateSpy = vi.fn().mockResolvedValue(customReport);

    const result = await runReport(
      { reports: '/does/not/matter', pr: 7 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' }, aggregate: aggregateSpy },
    );

    expect(aggregateSpy).toHaveBeenCalledWith('/does/not/matter');
    expect(result.report).toEqual(customReport);
  });

  it('throws a WardenError when no octokit is injected', async () => {
    await expect(
      runReport({ reports: reportsDir, pr: 482 }, { repo: { owner: 'acme', repo: 'checkout' } }),
    ).rejects.toThrow(WardenError);
  });

  it('throws a WardenError when no repo is injected', async () => {
    const octokit = makeMockOctokit();
    await expect(runReport({ reports: reportsDir, pr: 482 }, { octokit })).rejects.toThrow(
      WardenError,
    );
  });
});
