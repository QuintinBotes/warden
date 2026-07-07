import { beforeEach, describe, expect, it } from 'vitest';
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

function fakeExec(aggregate: unknown, risk = '7', runFull = 'false'): FakeExecState {
  const calls: { command: string; args: string[] }[] = [];
  const exec: ExecFn = (command, args) => {
    calls.push({ command, args });
    if (args.includes('analyze')) {
      return Promise.resolve({
        stdout: `test_tags=@apps/checkout\nrisk_score=${risk}\nrun_full_suite=${runFull}\n`,
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
});
