import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WardenError, defineConfig, type VcsRepoRef } from '@warden/core';
import { createFakeVcsProvider, fixtureExecution } from '@warden/core/testing';
import { executionToCtrf } from '@warden/reporter';
import { runReport, toGateReport } from './run-report';

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

  it('projects the run into a gate report a machine can read (`--json`)', async () => {
    // A failing tier, written beside the two passing ones the suite already seeds.
    const failing = executionToCtrf(
      fixtureExecution({
        results: [
          {
            testCaseId: 'TC-3',
            name: 'checkout applies the discount',
            filePath: 'apps/checkout/discount.spec.ts',
            status: 'FAIL',
            duration: 30,
            errorMessage: 'expected 200, got 500',
            artifacts: [],
            retries: 0,
            flakeFlag: false,
          },
        ],
      }),
    );
    await fs.writeFile(path.join(reportsDir, 'zz-failing.json'), JSON.stringify(failing), 'utf-8');

    const octokit = makeMockOctokit();
    const result = await runReport(
      { reports: reportsDir, pr: 482 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' } },
    );

    const json = toGateReport(result);

    expect(json.gate.decision).toBe(result.gate.decision);
    expect(json.gate.reason).toBe(result.gate.reason);
    expect(json.summary).toEqual({ total: 3, passed: 2, failed: 1 });
    expect(json.failures).toEqual([
      {
        path: 'apps/checkout/discount.spec.ts',
        message: 'expected 200, got 500',
        title: 'checkout applies the discount',
        annotation_level: 'failure',
      },
    ]);
    // The one-line human summary carries none of this — which is why `--json` exists.
    expect(`gate: ${result.gate.decision} — ${result.gate.reason}`).not.toContain('{');
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

  it('still reaches a gate decision when the agent report shares the artifacts directory', async () => {
    // The workflow `warden init` scaffolds points `--reports` at `warden-artifacts`, the same
    // directory `warden agent --output warden-artifacts/exploratory-report.json` writes into.
    // A gate job that dies on that file is indistinguishable from a gate that blocked.
    await fs.writeFile(
      path.join(reportsDir, 'exploratory-report.json'),
      JSON.stringify({ findings: [], markdownReport: '## No findings' }),
      'utf-8',
    );
    const octokit = makeMockOctokit();

    const result = await runReport(
      { reports: reportsDir, pr: 1 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' } },
    );

    expect(result.report.results.summary.tests).toBe(2);
    expect(result.gate.decision).toBe('PASS');
    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
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

  it('routes the comment and status through an injected VcsProvider (non-GitHub host)', async () => {
    const vcs = createFakeVcsProvider({ host: 'gitlab' });
    const repoRef: VcsRepoRef = { host: 'gitlab', owner: 'group', repo: 'checkout' };

    const result = await runReport(
      { reports: reportsDir, pr: 77 },
      { vcs, repoRef, headSha: 'sha-77' },
    );

    expect(result.gate.decision).toBe('PASS');
    expect(vcs.comments).toHaveLength(1);
    expect(vcs.comments[0]).toMatchObject({ repo: { host: 'gitlab' }, prNumber: 77 });
    expect(vcs.comments[0]!.body).toContain('Warden QA Report');
    expect(vcs.statuses).toHaveLength(1);
    expect(vcs.statuses[0]).toMatchObject({ headSha: 'sha-77', status: { context: 'warden-qa' } });
  });

  it('skips the status when no headSha is available on the VcsProvider path', async () => {
    const vcs = createFakeVcsProvider();
    const repoRef: VcsRepoRef = { host: 'bitbucket', owner: 'team', repo: 'checkout' };

    await runReport({ reports: reportsDir, pr: 5 }, { vcs, repoRef });

    expect(vcs.comments).toHaveLength(1);
    expect(vcs.statuses).toHaveLength(0);
  });

  it('throws a WardenError when deps.vcs is set without a repoRef', async () => {
    await expect(
      runReport({ reports: reportsDir, pr: 1 }, { vcs: createFakeVcsProvider() }),
    ).rejects.toThrow(WardenError);
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

  it('creates a failing check run on the GitHub path so a blocked gate is a red check', async () => {
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

    await runReport(
      { reports: reportsDir, pr: 9 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' }, headSha: 'deadbeef' },
    );

    expect(octokit.checks.create).toHaveBeenCalledTimes(1);
    expect(octokit.checks.create.mock.calls[0]?.[0]).toMatchObject({
      owner: 'acme',
      repo: 'checkout',
      head_sha: 'deadbeef',
      conclusion: 'failure',
    });
  });

  it('skips the check run when reporting.checkRunAnnotations is off', async () => {
    const octokit = makeMockOctokit();
    const config = defineConfig({ reporting: { checkRunAnnotations: false } });

    await runReport(
      { reports: reportsDir, pr: 9 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' }, headSha: 'deadbeef', config },
    );

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    expect(octokit.checks.create).not.toHaveBeenCalled();
  });

  it('skips the check run when no headSha is available on the GitHub path', async () => {
    const octokit = makeMockOctokit();

    await runReport(
      { reports: reportsDir, pr: 9 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' } },
    );

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(1);
    expect(octokit.checks.create).not.toHaveBeenCalled();
  });

  it('demands exit code 1 for a BLOCK and 0 for a PASS', async () => {
    const octokit = makeMockOctokit();

    const passing = await runReport(
      { reports: reportsDir, pr: 1 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' } },
    );
    expect(passing.gate.decision).toBe('PASS');
    expect(passing.exitCode).toBe(0);

    await fs.writeFile(
      path.join(reportsDir, 'failing.json'),
      JSON.stringify(
        executionToCtrf(
          fixtureExecution({
            results: [
              { testCaseId: 'TC-4', status: 'FAIL', duration: 5, retries: 0, flakeFlag: false },
            ],
          }),
        ),
      ),
      'utf-8',
    );

    const blocked = await runReport(
      { reports: reportsDir, pr: 1 },
      { octokit, repo: { owner: 'acme', repo: 'checkout' } },
    );
    expect(blocked.gate.decision).toBe('BLOCK');
    expect(blocked.exitCode).toBe(1);
  });

  it('demands exit code 1 for a BLOCK on the VcsProvider path too', async () => {
    await fs.writeFile(
      path.join(reportsDir, 'failing.json'),
      JSON.stringify(
        executionToCtrf(
          fixtureExecution({
            results: [
              { testCaseId: 'TC-5', status: 'FAIL', duration: 5, retries: 0, flakeFlag: false },
            ],
          }),
        ),
      ),
      'utf-8',
    );
    const vcs = createFakeVcsProvider({ host: 'gitlab' });
    const repoRef: VcsRepoRef = { host: 'gitlab', owner: 'group', repo: 'checkout' };

    const result = await runReport({ reports: reportsDir, pr: 3 }, { vcs, repoRef });

    expect(result.gate.decision).toBe('BLOCK');
    expect(result.exitCode).toBe(1);
  });
});

describe('toGateReport', () => {
  let reportsDir: string;

  beforeEach(async () => {
    reportsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-gate-report-'));
  });

  afterEach(async () => {
    await fs.rm(reportsDir, { recursive: true, force: true });
  });

  async function report(results: Parameters<typeof fixtureExecution>[0]['results']) {
    await fs.writeFile(
      path.join(reportsDir, 'run.json'),
      JSON.stringify(executionToCtrf(fixtureExecution({ results }))),
      'utf-8',
    );
    const result = await runReport(
      { reports: reportsDir, pr: 9 },
      { octokit: makeMockOctokit(), repo: { owner: 'acme', repo: 'checkout' } },
    );
    return toGateReport(result);
  }

  it('carries the decision and the counts the same run reported to the human', async () => {
    const gateReport = await report([
      { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
      { testCaseId: 'TC-2', status: 'PASS', duration: 12, retries: 0, flakeFlag: false },
    ]);

    expect(gateReport.gate).toEqual({ decision: 'PASS', reason: 'All tests passed' });
    expect(gateReport.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(gateReport.failures).toBeUndefined();
  });

  it('names each failing test file, so a CI host can annotate the line that broke', async () => {
    const gateReport = await report([
      {
        testCaseId: 'TC-3',
        name: 'checkout applies a discount',
        status: 'FAIL',
        duration: 5,
        retries: 0,
        flakeFlag: false,
        filePath: 'tests/checkout.spec.ts',
        errorMessage: 'expected 10, got 0',
      },
    ]);

    expect(gateReport.gate.decision).toBe('BLOCK');
    expect(gateReport.summary).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(gateReport.failures).toEqual([
      {
        annotation_level: 'failure',
        path: 'tests/checkout.spec.ts',
        message: 'expected 10, got 0',
        title: 'checkout applies a discount',
      },
    ]);
  });
});
