import { beforeEach, describe, expect, it } from 'vitest';
import type { PullRequest, QAPlatformPlugin } from '@warden/core';
import { run } from './run.js';
import type {
  ActionsCoreLike,
  ActionsSummaryLike,
  CreateCheckParams,
  CreateCommentParams,
  ExecFn,
  FsLike,
  OctokitLike,
} from './types.js';

const PR_EVENT = {
  pull_request: {
    number: 123,
    title: 'Payment retry',
    html_url: 'https://github.com/acme/shop/pull/123',
    head: { sha: 'head-sha-123' },
    base: { sha: 'base-sha-000' },
    user: { login: 'octocat' },
  },
  repository: { name: 'shop', owner: { login: 'acme' } },
};

interface FakeCore extends ActionsCoreLike {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  summaryRaw: string[];
  failed: string[];
  infos: string[];
  warnings: string[];
}

function fakeCore(inputs: Record<string, string>): FakeCore {
  const summaryRaw: string[] = [];
  const summary: ActionsSummaryLike = {
    addRaw(text) {
      summaryRaw.push(text);
      return summary;
    },
    write() {
      return Promise.resolve();
    },
  };
  const core: FakeCore = {
    inputs,
    outputs: {},
    summaryRaw,
    failed: [],
    infos: [],
    warnings: [],
    getInput(name, options) {
      const v = inputs[name] ?? '';
      if (!v && options?.required) throw new Error(`Input required and not supplied: ${name}`);
      return v;
    },
    setOutput(name, value) {
      core.outputs[name] = value;
    },
    info(m) {
      core.infos.push(m);
    },
    warning(m) {
      core.warnings.push(m);
    },
    error() {},
    setFailed(m) {
      core.failed.push(m);
    },
    summary,
  };
  return core;
}

interface FakeExecState {
  calls: { command: string; args: string[] }[];
  exec: ExecFn;
}

function fakeExec(
  aggregate: unknown,
  risk = '7',
  runFull = 'false',
  configured?: string,
): FakeExecState {
  const calls: { command: string; args: string[] }[] = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    if (args.includes('analyze')) {
      // `configured` omitted reproduces a CLI old enough not to emit the line at all.
      const provenance = configured === undefined ? '' : `configured=${configured}\n`;
      return Promise.resolve({
        stdout: `test_tags=@apps/checkout\nrisk_score=${risk}\nrun_full_suite=${runFull}\n${provenance}`,
        stderr: '',
      });
    }
    if (args.includes('aggregate')) {
      return Promise.resolve({ stdout: JSON.stringify(aggregate), stderr: '' });
    }
    return Promise.resolve({ stdout: '{}', stderr: '' });
  };
  return { calls, exec };
}

interface FakeOctokitState {
  comments: CreateCommentParams[];
  checks: CreateCheckParams[];
  octokit: OctokitLike;
}

function fakeOctokit(): FakeOctokitState {
  const comments: CreateCommentParams[] = [];
  const checks: CreateCheckParams[] = [];
  return {
    comments,
    checks,
    octokit: {
      issues: {
        createComment(params) {
          comments.push(params);
          return Promise.resolve({});
        },
      },
      checks: {
        create(params) {
          checks.push(params);
          return Promise.resolve({});
        },
      },
    },
  };
}

function fakeFs(event: unknown): FsLike {
  return { readFileSync: () => JSON.stringify(event) };
}

const BLOCK_REPORT = {
  gate: { decision: 'BLOCK', reason: '1 CRITICAL failure(s)' },
  reportPath: 'warden-reports/warden-ctrf.json',
  summary: { total: 47, passed: 44, failed: 3 },
  failures: [
    {
      path: 'apps/checkout/pay.ts',
      line: 42,
      message: 'Payment failed',
      title: 'pay',
      priority: 'P1',
    },
  ],
  findings: [
    {
      title: 'Payment fails for Visa 4242',
      severity: 'CRITICAL',
      steps: ['Add to cart', 'Checkout'],
      expected: 'Payment confirmed',
      actual: 'Error processing payment',
    },
  ],
};

const inputs = {
  provider: 'anthropic',
  strategy: 'exploratory',
  'risk-threshold': '4',
  'anthropic-api-key': 'sk-test',
};

describe('run', () => {
  let core: FakeCore;
  let octo: FakeOctokitState;

  beforeEach(() => {
    core = fakeCore({ ...inputs });
    octo = fakeOctokit();
  });

  it('runs the tiers, sets outputs, and produces all four reporting surfaces', async () => {
    const { calls, exec } = fakeExec(BLOCK_REPORT, '7', 'false');
    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    // Outputs
    expect(core.outputs.gate).toBe('BLOCK');
    expect(core.outputs['risk-score']).toBe('7');
    expect(core.outputs['report-path']).toBe('warden-reports/warden-ctrf.json');
    expect(result.gate).toBe('BLOCK');

    // Surface 2: job summary markdown written
    expect(core.summaryRaw.join('\n')).toContain('AI QA Report');
    expect(core.summaryRaw.join('\n')).toContain('BLOCK');

    // Surface 3: PR review comment posted
    expect(octo.comments).toHaveLength(1);
    expect(octo.comments[0]?.issue_number).toBe(123);
    expect(octo.comments[0]?.owner).toBe('acme');
    expect(octo.comments[0]?.body).toContain('Payment fails for Visa 4242');

    // Surface 4: check run with annotations
    expect(octo.checks).toHaveLength(1);
    const check = octo.checks[0]!;
    expect(check.head_sha).toBe('head-sha-123');
    expect(check.conclusion).toBe('failure');
    expect(check.output?.annotations).toHaveLength(1);
    expect(check.output?.annotations?.[0]).toMatchObject({
      path: 'apps/checkout/pay.ts',
      start_line: 42,
      annotation_level: 'failure',
    });

    // BLOCK fails the job
    expect(core.failed.length).toBeGreaterThan(0);

    // Tier orchestration: analyze -> smoke run -> selective run -> agent -> aggregate
    const subcommands = calls.map((c) =>
      c.args
        .filter((a) => !a.startsWith('-'))
        .slice(0, 2)
        .join(' '),
    );
    expect(subcommands[0]).toBe('warden analyze');
    expect(subcommands.filter((s) => s.startsWith('warden run')).length).toBe(2);
    expect(subcommands.some((s) => s === 'warden agent')).toBe(true);
    expect(subcommands[subcommands.length - 1]).toBe('warden report');
    expect(result.ranAgent).toBe(true);
    expect(result.commentPosted).toBe(true);
    expect(result.checkRunCreated).toBe(true);

    // The selective tier greps the changed tags (run_full_suite=false)
    const runCall = calls.find((c) => c.args.includes('run') && c.args.includes('@apps/checkout'));
    expect(runCall).toBeDefined();
  });

  it('never posts a silently confident green for a repository with no warden.config', async () => {
    const passing = {
      gate: { decision: 'PASS', reason: 'All tests passed' },
      reportPath: 'warden-reports/warden-ctrf.json',
      summary: { total: 1, passed: 1, failed: 0 },
    };
    const { exec } = fakeExec(passing, '3', 'false', 'false');

    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    // The gate itself is untouched: the tests that ran passed, so the check stays green.
    expect(result.gate).toBe('PASS');
    expect(octo.checks[0]?.conclusion).toBe('success');
    // But every surface says where the risk score came from.
    expect(core.warnings.some((w) => /no warden\.config/i.test(w))).toBe(true);
    expect(octo.comments[0]?.body).toContain('warden.config');
    expect(core.summaryRaw.join('\n')).toContain('warden.config');
    expect(core.outputs.configured).toBe('false');
    expect(result.configured).toBe(false);
  });

  it('claims a repository is configured only when the CLI said so', async () => {
    const passing = { gate: { decision: 'PASS', reason: 'All tests passed' } };

    const withLine = await run({
      core,
      octokit: octo.octokit,
      exec: fakeExec(passing, '3', 'false', 'true').exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });
    expect(withLine.configured).toBe(true);
    expect(core.outputs.configured).toBe('true');

    // An older CLI emits no `configured` line; unknown provenance is neither claim.
    const core2 = fakeCore({ ...inputs });
    const withoutLine = await run({
      core: core2,
      octokit: fakeOctokit().octokit,
      exec: fakeExec(passing, '3', 'false').exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });
    expect(withoutLine.configured).toBeUndefined();
    expect(core2.outputs.configured).toBeUndefined();
    expect(core2.warnings.some((w) => /warden\.config/i.test(w))).toBe(false);
  });

  it('fails closed (BLOCK) when the aggregate step crashes', async () => {
    const exec: ExecFn = (_command, args) => {
      if (args.includes('analyze')) {
        return Promise.resolve({
          stdout: 'test_tags=@x\nrisk_score=1\nrun_full_suite=false\n',
          stderr: '',
        });
      }
      if (args.includes('aggregate')) {
        return Promise.reject(new Error('aggregate boom'));
      }
      return Promise.resolve({ stdout: '{}', stderr: '' });
    };

    await run({
      core,
      octokit: octo.octokit,
      exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    // A gate that could not be evaluated must never read as green.
    expect(core.outputs.gate).toBe('BLOCK');
    expect(core.failed.length).toBeGreaterThan(0);
  });

  it('skips the AI agent when risk is below the threshold and passes the gate', async () => {
    const passReport = {
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      reportPath: 'warden-reports/warden-ctrf.json',
      summary: { total: 10, passed: 10, failed: 0 },
      failures: [],
      findings: [],
    };
    const { calls, exec } = fakeExec(passReport, '2', 'false');
    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(result.ranAgent).toBe(false);
    expect(calls.some((c) => c.args.includes('agent'))).toBe(false);
    expect(core.outputs.gate).toBe('PASS');
    expect(core.failed).toHaveLength(0);
    expect(octo.checks[0]?.conclusion).toBe('success');
  });

  it('says the agent did not run — and why — when the agent tier fails', async () => {
    const passReport = {
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      reportPath: 'warden-reports/warden-ctrf.json',
      summary: { total: 10, passed: 10, failed: 0 },
      failures: [],
      findings: [],
    };
    const exec: ExecFn = (_command, args) => {
      if (args.includes('analyze')) {
        return Promise.resolve({
          stdout: 'test_tags=@apps/checkout\nrisk_score=8\nrun_full_suite=false\n',
          stderr: '',
        });
      }
      if (args.includes('aggregate')) {
        return Promise.resolve({ stdout: JSON.stringify(passReport), stderr: '' });
      }
      if (args.includes('agent')) {
        return Promise.reject(new Error("error: unknown option '--provider'"));
      }
      return Promise.resolve({ stdout: '{}', stderr: '' });
    };

    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(result.ranAgent).toBe(false);
    // The PR comment, the job summary and the check-run all carry the same Markdown, so none of
    // them may credit an agent that crashed before it made a single request.
    const body = octo.comments[0]?.body ?? '';
    expect(body).not.toContain('No bugs found');
    expect(body).toContain('did not report on this PR');
    expect(body).toContain("unknown option '--provider'");
    expect(core.summaryRaw.join('\n')).not.toContain('No bugs found');
    expect(octo.checks[0]?.output?.summary ?? '').not.toContain('No bugs found');
  });

  it('says the agent was skipped, not clean, when risk is below the threshold', async () => {
    const passReport = {
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      reportPath: 'warden-reports/warden-ctrf.json',
      summary: { total: 10, passed: 10, failed: 0 },
      failures: [],
      findings: [],
    };
    const { exec } = fakeExec(passReport, '2', 'false');
    await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    const body = octo.comments[0]?.body ?? '';
    expect(body).not.toContain('No bugs found');
    expect(body).toContain('risk 2 is below the threshold of 4');
  });

  it('still reports a clean agent run as clean', async () => {
    const passReport = {
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      reportPath: 'warden-reports/warden-ctrf.json',
      summary: { total: 10, passed: 10, failed: 0 },
      failures: [],
      findings: [],
    };
    const { exec } = fakeExec(passReport, '8', 'false');
    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(result.ranAgent).toBe(true);
    expect(octo.comments[0]?.body ?? '').toContain('No bugs found by the AI exploratory agent');
  });

  it('runs the full regression suite when run_full_suite is true', async () => {
    const { calls, exec } = fakeExec(BLOCK_REPORT, '8', 'true');
    await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });
    const regression = calls.find((c) => c.args.includes('run') && c.args.includes('@regression'));
    expect(regression).toBeDefined();
  });

  it('no-ops (skips) when the event is not a pull request', async () => {
    const { exec } = fakeExec(BLOCK_REPORT);
    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs({ ref: 'refs/heads/main' }),
    });
    expect(result.skipped).toBe(true);
    expect(octo.comments).toHaveLength(0);
    expect(octo.checks).toHaveLength(0);
  });

  it('fires onPROpened once at startup, from the PR event payload, on every configured plugin', async () => {
    const { exec } = fakeExec(BLOCK_REPORT, '7', 'false');
    const seen: PullRequest[] = [];
    const plugin: QAPlatformPlugin = {
      name: 'recorder',
      async onPROpened(pr) {
        seen.push(pr);
      },
    };

    await run({
      core,
      octokit: octo.octokit,
      exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
      plugins: [plugin],
    });

    expect(seen).toEqual([
      {
        number: 123,
        title: 'Payment retry',
        url: 'https://github.com/acme/shop/pull/123',
        headSha: 'head-sha-123',
        baseSha: 'base-sha-000',
        author: 'octocat',
      },
    ]);
  });

  it('does not fire onPROpened when the event is not a pull request', async () => {
    const { exec } = fakeExec(BLOCK_REPORT);
    const seen: PullRequest[] = [];
    const plugin: QAPlatformPlugin = {
      name: 'recorder',
      async onPROpened(pr) {
        seen.push(pr);
      },
    };

    await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs({ ref: 'refs/heads/main' }),
      plugins: [plugin],
    });

    expect(seen).toHaveLength(0);
  });

  it('fails closed (BLOCK) when a test tier crashes, naming the lost tier on every surface', async () => {
    // The regression tier — the one selected to cover this diff — dies. The smoke tier's CTRF
    // file survives, so `warden report aggregate` scores a green subset of the suite.
    const exec: ExecFn = (_command, args) => {
      const sub = args.slice(args.indexOf('warden') + 1).join(' ');
      if (sub.startsWith('analyze')) {
        return Promise.resolve({
          stdout: 'test_tags=@apps/checkout\nrisk_score=2\nrun_full_suite=false\n',
          stderr: '',
        });
      }
      if (sub.startsWith('run --grep @apps/checkout')) {
        return Promise.reject(new Error('playwright: browser crashed (SIGKILL)'));
      }
      if (sub.startsWith('report aggregate')) {
        return Promise.resolve({
          stdout: JSON.stringify({
            gate: { decision: 'PASS', reason: 'All tests passed' },
            summary: { total: 3, passed: 3, failed: 0 },
          }),
          stderr: '',
        });
      }
      return Promise.resolve({ stdout: '{}', stderr: '' });
    };

    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    // A verdict over an unknown subset of the suite is not a PASS.
    expect(result.gate).toBe('BLOCK');
    expect(core.outputs.gate).toBe('BLOCK');
    expect(result.incompleteTiers).toEqual([
      { name: 'regression', message: 'playwright: browser crashed (SIGKILL)' },
    ]);
    expect(core.outputs['incomplete-tiers']).toBe('regression');

    // The step is red, not green-with-a-warning.
    expect(core.failed.length).toBeGreaterThan(0);
    expect(core.failed.join('\n')).toContain('regression');

    // Surface 4: the check run is a failure and its title says what was lost.
    expect(octo.checks[0]?.conclusion).toBe('failure');
    expect(octo.checks[0]?.output?.title).toMatch(/regression/);
    expect(octo.checks[0]?.output?.title).not.toBe('Warden QA: PASS');

    // Surfaces 2 and 3: the job summary and the PR comment both say a tier was lost, and why.
    const summaryText = core.summaryRaw.join('\n');
    expect(summaryText).toContain('regression');
    expect(summaryText).toContain('browser crashed');
    expect(octo.comments[0]?.body).toContain('browser crashed');
  });

  it('fails closed when the risk-gated AI agent tier crashes', async () => {
    const exec: ExecFn = (_command, args) => {
      const sub = args.slice(args.indexOf('warden') + 1).join(' ');
      if (sub.startsWith('analyze')) {
        return Promise.resolve({
          stdout: 'test_tags=@apps/checkout\nrisk_score=8\nrun_full_suite=false\n',
          stderr: '',
        });
      }
      if (sub.startsWith('agent')) {
        return Promise.reject(new Error('anthropic: 529 overloaded'));
      }
      if (sub.startsWith('report aggregate')) {
        return Promise.resolve({
          stdout: JSON.stringify({
            gate: { decision: 'PASS', reason: 'All tests passed' },
            summary: { total: 9, passed: 9, failed: 0 },
          }),
          stderr: '',
        });
      }
      return Promise.resolve({ stdout: '{}', stderr: '' });
    };

    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(result.ranAgent).toBe(false);
    expect(result.gate).toBe('BLOCK');
    expect(result.incompleteTiers.map((t) => t.name)).toEqual(['agent']);
    expect(core.failed.length).toBeGreaterThan(0);
  });

  it('keeps the aggregate BLOCK reason when a tier also failed to complete', async () => {
    const exec: ExecFn = (_command, args) => {
      const sub = args.slice(args.indexOf('warden') + 1).join(' ');
      if (sub.startsWith('analyze')) {
        return Promise.resolve({
          stdout: 'test_tags=@apps/checkout\nrisk_score=1\nrun_full_suite=false\n',
          stderr: '',
        });
      }
      if (sub.startsWith('run --grep @smoke')) {
        return Promise.reject(new Error('runner evicted'));
      }
      if (sub.startsWith('report aggregate')) {
        return Promise.resolve({ stdout: JSON.stringify(BLOCK_REPORT), stderr: '' });
      }
      return Promise.resolve({ stdout: '{}', stderr: '' });
    };

    await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    const failed = core.failed.join('\n');
    expect(failed).toContain('smoke');
    expect(failed).toContain('1 CRITICAL failure(s)');
  });

  it('reports no incomplete tiers when every tier completes', async () => {
    const passReport = {
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      reportPath: 'warden-reports/warden-ctrf.json',
      summary: { total: 10, passed: 10, failed: 0 },
    };
    const { exec } = fakeExec(passReport, '2', 'false');
    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(result.incompleteTiers).toEqual([]);
    expect(core.outputs['incomplete-tiers']).toBe('');
    expect(result.gate).toBe('PASS');
    expect(core.summaryRaw.join('\n')).not.toContain('did not complete');
  });

  it('treats an unreadable diff as an unknown change surface, not as risk 0', async () => {
    // `actions/checkout` defaults to `fetch-depth: 1`, which leaves the PR's base commit out of
    // the clone, so `git diff <base> <head>` cannot run. That is an absent measurement. Read as a
    // measured 0 it silently deselects the whole pipeline: the diff-scoped tier falls back to
    // `@smoke` (already run), the agent is skipped, and the report claims LOW risk.
    const seen: string[] = [];
    const exec: ExecFn = (_command, args) => {
      const sub = args.slice(args.indexOf('warden') + 1).join(' ');
      seen.push(sub);
      if (sub.startsWith('analyze')) {
        return Promise.reject(
          new Error(
            'Failed to run `git diff --name-status base-sha-000 head-sha-123`: fatal: bad object base-sha-000',
          ),
        );
      }
      if (sub.startsWith('report aggregate')) {
        return Promise.resolve({
          stdout: JSON.stringify({
            gate: { decision: 'PASS', reason: 'All tests passed' },
            summary: { total: 4, passed: 4, failed: 0 },
          }),
          stderr: '',
        });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    };

    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: { GITHUB_REPOSITORY: 'acme/shop' },
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    // Surface 1: the output says unknown. `0` would be indistinguishable from a measured 0.
    expect(result.riskScore).toBeNull();
    expect(core.outputs['risk-score']).toBe('unknown');

    // Scope escalates instead of collapsing: the full regression suite runs, and the smoke tier
    // is not run twice under a different name.
    expect(seen.filter((s) => s.startsWith('run --grep @smoke')).length).toBe(1);
    expect(seen.some((s) => s.startsWith('run --grep @regression'))).toBe(true);

    // An unknown risk cannot be below the threshold, so the agent is not skipped.
    expect(result.ranAgent).toBe(true);
    expect(seen.some((s) => s.startsWith('agent'))).toBe(true);

    // Surfaces 2, 3 and 4 all say unknown, and none of them claims LOW risk.
    const summaryText = core.summaryRaw.join('\n');
    const body = octo.comments[0]?.body ?? '';
    const check = octo.checks[0]?.output?.summary ?? '';
    for (const text of [summaryText, body, check]) {
      expect(text).toContain('**Risk Score:** unknown');
      expect(text).not.toContain('0/10');
      expect(text).not.toContain('LOW');
      expect(text).toContain('fatal: bad object base-sha-000');
      expect(text).toContain('fetch-depth: 0');
    }
  });

  it.each([
    ['no output at all', ''],
    ['no risk_score key', 'test_tags=@apps/checkout\nrun_full_suite=false\n'],
    ['an empty risk_score', 'risk_score=\n'],
    ['an unreadable risk_score', 'risk_score=n/a\n'],
  ])('does not invent a risk score when analyze completes with %s', async (_name, stdout) => {
    // `Number('')` is 0 and `Number(undefined)` is NaN; neither absence is a measurement of zero.
    const exec: ExecFn = (_command, args) => {
      const sub = args.slice(args.indexOf('warden') + 1).join(' ');
      if (sub.startsWith('analyze')) return Promise.resolve({ stdout, stderr: '' });
      if (sub.startsWith('report aggregate')) {
        return Promise.resolve({
          stdout: JSON.stringify({ gate: { decision: 'PASS', reason: 'ok' } }),
          stderr: '',
        });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    };

    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(result.riskScore).toBeNull();
    expect(core.outputs['risk-score']).toBe('unknown');
    expect(result.ranAgent).toBe(true);
  });

  it('still reports a measured risk of 0 as a measurement', async () => {
    const passReport = { gate: { decision: 'PASS', reason: 'All exit criteria met' } };
    const { exec } = fakeExec(passReport, '0', 'false');
    const result = await run({
      core,
      octokit: octo.octokit,
      exec,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(result.riskScore).toBe(0);
    expect(core.outputs['risk-score']).toBe('0');
    expect(result.ranAgent).toBe(false);
    expect(octo.comments[0]?.body).toContain('0/10');
    expect(octo.comments[0]?.body).not.toContain('unknown');
  });

  it('says the selective tier fell back to smoke when analyze produced no tags', async () => {
    const { calls, exec } = fakeExec(BLOCK_REPORT, '2', 'false');
    // A repo whose modules are not under `apps/` or `src/features/`: analyze finds nothing.
    const noTags: ExecFn = (command, args) =>
      args.includes('analyze')
        ? Promise.resolve({
            stdout: 'test_tags=\nrisk_score=2\nrun_full_suite=false\n',
            stderr: '',
          })
        : exec(command, args);

    await run({
      core,
      octokit: octo.octokit,
      exec: noTags,
      env: {},
      eventPath: '/event.json',
      fs: fakeFs(PR_EVENT),
    });

    expect(core.warnings.some((w) => w.includes('scope.modulePaths'))).toBe(true);
    // And the fallback it warned about is the one the regression tier actually took.
    const regression = calls.find((c) => c.args.some((a) => a.endsWith('regression.ctrf.json')));
    expect(regression?.args).toContain('@smoke');
  });
});
