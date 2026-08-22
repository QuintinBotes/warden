import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load as parseYaml } from 'js-yaml';
import { fixtureExecution } from '@warden/core/testing';
import { executionToCtrf } from '@warden/reporter';
import { runInit } from './run-init';
import { runReport } from './run-report';

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
}

interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<string, { steps: WorkflowStep[] }>;
}

/** Every value of `--<flag> <value>` in a step's `run` script. */
function flagValues(run: string | undefined, flag: string): string[] {
  return [...(run ?? '').matchAll(new RegExp(`--${flag}\\s+(\\S+)`, 'g'))].map((m) => m[1]!);
}

function stepsUsing(job: { steps: WorkflowStep[] }, action: string): WorkflowStep[] {
  return job.steps.filter((step) => (step.uses ?? '').startsWith(action));
}

/** Turns an `actions/download-artifact` glob (`warden-ctrf-*`) into a matcher. */
function globMatcher(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

async function scaffoldedWorkflow(dir: string): Promise<Workflow> {
  const result = await runInit({ cwd: dir });
  return parseYaml(await fs.readFile(result.workflowPath, 'utf-8')) as Workflow;
}

/** The slice of a GitHub Actions workflow this test reads back out of the scaffold. */
interface WorkflowFile {
  jobs: Record<string, { steps: { run?: string; 'continue-on-error'?: boolean }[] }>;
}

describe('runInit', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-init-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('scaffolds an import-free warden.config.ts that loads without deps installed', async () => {
    const result = await runInit({ cwd: dir });

    expect(result.configPath).toBe(path.join(dir, 'warden.config.ts'));
    const config = await fs.readFile(result.configPath, 'utf-8');
    // Import-free so a one-off `npx --package=@warden/cli -- warden init` run works before
    // @warden/core is resolvable: no real top-level import statement (the JSDoc may mention
    // one as an example).
    expect(config).not.toMatch(/^import /m);
    expect(config).toContain('export default {');
    expect(config).toContain("provider: 'anthropic'");
    expect(config).toContain('WardenConfigInput'); // JSDoc type for editor support
  });

  it('scaffolds a sample .github/workflows/ai-qa.yml', async () => {
    const result = await runInit({ cwd: dir });

    expect(result.workflowPath).toBe(path.join(dir, '.github', 'workflows', 'ai-qa.yml'));
    const workflow = await fs.readFile(result.workflowPath, 'utf-8');
    expect(workflow).toContain('warden analyze');
    expect(workflow).toContain('warden run');
    expect(workflow).toContain('pull_request');
  });

  it('points the gate job at the PR head commit, not the merge commit', async () => {
    const result = await runInit({ cwd: dir });
    const workflow = await fs.readFile(result.workflowPath, 'utf-8');

    // The qa-gate job is the only gating job in the scaffold: its check run has to land on the
    // commit a required status check is read off, or it guards nothing. The value reaches the
    // command through env:, never spliced into the run: script.
    expect(workflow).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    expect(workflow).toContain(
      'warden report aggregate --reports warden-artifacts --pr "$PR_NUMBER" --head-sha "$HEAD_SHA"',
    );
  });

  it('scaffolds a workflow whose gate step is the only one allowed to fail the run', async () => {
    const result = await runInit({ cwd: dir });
    const workflow = parseYaml(await fs.readFile(result.workflowPath, 'utf-8')) as WorkflowFile;

    // A tier that blocks now exits 1. If the tier jobs failed on that, the gate job would
    // never aggregate, and the PR would go red with no verdict comment on it.
    for (const job of ['smoke', 'selective']) {
      const step = workflow.jobs[job]!.steps.find((s) => s.run?.includes('warden run'));
      expect(step, `${job} runs a tier`).toBeDefined();
      expect(step!['continue-on-error']).toBe(true);
    }

    // The gate step is the merge verdict, so its exit code has to reach the runner.
    const gate = workflow.jobs['qa-gate']!.steps.find((s) => s.run?.includes('report aggregate'));
    expect(gate).toBeDefined();
    expect(gate!['continue-on-error']).toBeUndefined();
  });

  it('installs Playwright in the scaffolded workflow before a tier tries to run it', async () => {
    const result = await runInit({ cwd: dir });
    const workflow = await fs.readFile(result.workflowPath, 'utf-8');

    // `warden run` launches the repo's own Playwright and never fetches one, so a workflow that
    // installs nothing would fail every tier it scaffolds.
    const smokeAt = workflow.indexOf('warden run --grep "@smoke"');
    // The selective tier reads its tags from env:, so this is the line that runs it.
    const selectiveAt = workflow.indexOf('warden run --grep "$TEST_TAGS"');
    const installs = [...workflow.matchAll(/npx playwright install/g)].map((m) => m.index ?? -1);

    expect(smokeAt).toBeGreaterThan(-1);
    expect(selectiveAt).toBeGreaterThan(-1);
    expect(installs).toHaveLength(2);
    expect(installs.some((at) => at < smokeAt && at > workflow.indexOf('jobs:'))).toBe(true);
    expect(installs.some((at) => at < selectiveAt && at > smokeAt)).toBe(true);
  });

  // `npx warden …` does not resolve this CLI. The unscoped name `warden` on npm is an
  // unrelated 2014 package that declares no `bin`, so a scaffolded workflow spelled that way
  // downloads a stranger's tarball onto the user's runner and dies there with "could not
  // determine executable to run" — a failure that names nothing they can act on.
  it('scaffolds CLI steps that name @warden/cli, never the unscoped `warden` package', async () => {
    const result = await runInit({ cwd: dir });
    const files = await Promise.all([
      fs.readFile(result.workflowPath, 'utf-8'),
      fs.readFile(result.configPath, 'utf-8'),
    ]);

    const npxCalls = files.flatMap((text) => [...text.matchAll(/npx\s+[^\n`]*/g)].map((m) => m[0]));
    expect(npxCalls.length, 'the scaffolded workflow runs the CLI at least once').toBeGreaterThan(
      0,
    );
    for (const call of npxCalls) {
      // A flag starts with a letter after its dashes, so the bare `--` separator does not
      // match: `npx --yes --package=@warden/cli -- warden run` is the correct spelling.
      // This holds for every npx call in the scaffold, Warden's or not.
      expect(call).not.toMatch(/^npx\s+(?:--?[A-Za-z]\S*\s+)*warden\b/);
    }

    // The scaffold also runs `npx playwright install`, which is not Warden's CLI. Only the
    // calls that invoke `warden` have to name the package it comes from.
    const wardenCalls = npxCalls.filter((call) => /\bwarden\b/.test(call));
    expect(
      wardenCalls.length,
      'the scaffolded workflow runs the CLI at least once',
    ).toBeGreaterThan(0);
    for (const call of wardenCalls) {
      expect(call, `\`${call}\` does not name the package the binary comes from`).toContain(
        '@warden/cli',
      );
    }
  });

  it('creates the .github/workflows directory tree', async () => {
    await runInit({ cwd: dir });
    const stat = await fs.stat(path.join(dir, '.github', 'workflows'));
    expect(stat.isDirectory()).toBe(true);
  });

  // Each job in the scaffolded workflow runs on its own runner with its own filesystem.
  // Reports only reach the gate if a job uploads them and the gate downloads them, and a
  // gate that reads nothing reports "no tests ran" and exits 0 — a pipeline that cannot
  // block a merge and does not say so.
  describe('the scaffolded workflow can actually gate', () => {
    it('uploads every artifacts directory a tier writes', async () => {
      const workflow = await scaffoldedWorkflow(dir);

      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        const written = job.steps.flatMap((step) => flagValues(step.run, 'artifacts-dir'));
        if (written.length === 0) continue;

        const uploadedPaths = stepsUsing(job, 'actions/upload-artifact').map((s) => s.with?.path);
        for (const artifactsDir of written) {
          expect(
            uploadedPaths,
            `job "${jobName}" writes ${artifactsDir} but uploads nothing`,
          ).toContain(artifactsDir);
        }
      }
    });

    it('downloads the reports into the very directory the gate aggregates', async () => {
      const workflow = await scaffoldedWorkflow(dir);
      const gate = workflow.jobs['qa-gate']!;

      const aggregateStep = gate.steps.find((s) => (s.run ?? '').includes('report aggregate'));
      expect(aggregateStep).toBeDefined();
      const reportsDir = flagValues(aggregateStep!.run, 'reports')[0];

      const download = stepsUsing(gate, 'actions/download-artifact')[0];
      expect(download, 'the gate job downloads no artifacts').toBeDefined();
      expect(download!.with?.path).toBe(reportsDir);
    });

    it('names every CTRF artifact so the gate pattern matches it, and the agent report so it does not', async () => {
      const workflow = await scaffoldedWorkflow(dir);
      const gate = workflow.jobs['qa-gate']!;
      const pattern = stepsUsing(gate, 'actions/download-artifact')[0]!.with?.pattern;
      expect(pattern).toBeTruthy();
      const matches = globMatcher(pattern!);

      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (jobName === 'qa-gate') continue;
        const writesCtrf = job.steps.some((s) => flagValues(s.run, 'artifacts-dir').length > 0);
        for (const upload of stepsUsing(job, 'actions/upload-artifact')) {
          const name = upload.with?.name ?? '';
          // `warden agent` writes an AgentOutput, not CTRF; aggregating it would throw.
          expect(matches.test(name), `${name} (job "${jobName}") vs ${pattern}`).toBe(writesCtrf);
        }
      }
    });

    it('keeps the agent report out of the directory the gate aggregates', async () => {
      const workflow = await scaffoldedWorkflow(dir);
      const gate = workflow.jobs['qa-gate']!;
      const aggregateStep = gate.steps.find((s) => (s.run ?? '').includes('report aggregate'))!;
      const reportsDir = flagValues(aggregateStep.run, 'reports')[0]!;

      const agentOutputs = Object.values(workflow.jobs).flatMap((job) =>
        job.steps
          .filter((s) => (s.run ?? '').includes('warden agent'))
          .flatMap((s) => flagValues(s.run, 'output')),
      );
      expect(agentOutputs.length).toBeGreaterThan(0);
      for (const output of agentOutputs) {
        expect(output.startsWith(`${reportsDir}/`)).toBe(false);
      }
    });

    it('grants the gate the permissions its PR comment and check run need', async () => {
      const workflow = await scaffoldedWorkflow(dir);

      expect(workflow.permissions?.['pull-requests']).toBe('write');
      expect(workflow.permissions?.['checks']).toBe('write');
    });

    it('refuses to pass a gate that downloaded no reports', async () => {
      const workflow = await scaffoldedWorkflow(dir);
      const gate = workflow.jobs['qa-gate']!;

      // Zero reports aggregate to WARN "no tests ran", which exits 0. Something in the gate
      // job has to turn that into a failure, or a pipeline where every tier died is green.
      const guard = gate.steps.find((s) => (s.run ?? '').includes('exit 1'));
      expect(guard, 'the gate job has no guard against an empty report set').toBeDefined();
    });

    it('blocks on a failing test that a tier wrote into its own subdirectory', async () => {
      const workflow = await scaffoldedWorkflow(dir);
      const gate = workflow.jobs['qa-gate']!;
      const aggregateStep = gate.steps.find((s) => (s.run ?? '').includes('report aggregate'))!;
      const reportsDir = flagValues(aggregateStep.run, 'reports')[0]!;
      const artifactName = stepsUsing(workflow.jobs['selective']!, 'actions/upload-artifact')[0]!
        .with!.name!;

      // `actions/download-artifact` unpacks each artifact into a directory of its own under
      // `path`, so this is the layout the gate runner really sees.
      const unpacked = path.join(dir, reportsDir, artifactName);
      await fs.mkdir(unpacked, { recursive: true });
      await fs.writeFile(
        path.join(unpacked, 'ctrf-report.json'),
        JSON.stringify(
          executionToCtrf(
            fixtureExecution({
              results: [
                { testCaseId: 'TC-9', status: 'FAIL', duration: 5, retries: 0, flakeFlag: false },
              ],
            }),
          ),
        ),
        'utf-8',
      );

      const octokit = {
        issues: { createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
        checks: { create: vi.fn().mockResolvedValue({ data: { id: 1 } }) },
      };
      const result = await runReport(
        { reports: path.join(dir, reportsDir), pr: 7 },
        { octokit, repo: { owner: 'acme', repo: 'checkout' } },
      );

      expect(result.report.results.summary.failed).toBe(1);
      expect(result.gate.decision).toBe('BLOCK');
    });
  });
});

describe('runInit does not destroy what the user customized', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-init-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const CUSTOM_CONFIG =
    '// MY CUSTOM CONFIG\nexport default { gates: { blockOnPassRateBelowPercent: 42 } };\n';
  const CUSTOM_WORKFLOW = 'name: my precious workflow\n';

  async function customize(): Promise<void> {
    await fs.mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(dir, 'warden.config.ts'), CUSTOM_CONFIG, 'utf-8');
    await fs.writeFile(
      path.join(dir, '.github', 'workflows', 'ai-qa.yml'),
      CUSTOM_WORKFLOW,
      'utf-8',
    );
  }

  it('leaves a customized config and workflow untouched when nothing confirms the overwrite', async () => {
    await customize();

    const result = await runInit({ cwd: dir });

    expect(await fs.readFile(result.configPath, 'utf-8')).toBe(CUSTOM_CONFIG);
    expect(await fs.readFile(result.workflowPath, 'utf-8')).toBe(CUSTOM_WORKFLOW);
    expect(result.files.map((f) => f.status)).toEqual(['kept', 'kept']);
  });

  it('overwrites only the files the caller confirms', async () => {
    await customize();
    const asked: string[] = [];

    const result = await runInit({
      cwd: dir,
      confirmOverwrite: (file) => {
        asked.push(path.basename(file));
        return path.basename(file) === 'warden.config.ts';
      },
    });

    expect(asked).toEqual(['warden.config.ts', 'ai-qa.yml']);
    expect(await fs.readFile(result.configPath, 'utf-8')).toContain("provider: 'anthropic'");
    expect(await fs.readFile(result.workflowPath, 'utf-8')).toBe(CUSTOM_WORKFLOW);
    expect(result.files.map((f) => f.status)).toEqual(['overwritten', 'kept']);
  });

  it('overwrites without asking under force', async () => {
    await customize();
    let asked = 0;

    const result = await runInit({
      cwd: dir,
      force: true,
      confirmOverwrite: () => {
        asked += 1;
        return true;
      },
    });

    expect(asked).toBe(0);
    expect(await fs.readFile(result.configPath, 'utf-8')).toContain("provider: 'anthropic'");
    expect(result.files.map((f) => f.status)).toEqual(['overwritten', 'overwritten']);
  });

  it('does not ask about a file that already matches the template', async () => {
    await runInit({ cwd: dir });
    let asked = 0;

    const result = await runInit({
      cwd: dir,
      confirmOverwrite: () => {
        asked += 1;
        return true;
      },
    });

    expect(asked).toBe(0);
    expect(result.files.map((f) => f.status)).toEqual(['unchanged', 'unchanged']);
  });

  it('reports a first run as created', async () => {
    const result = await runInit({ cwd: dir });
    expect(result.files.map((f) => f.status)).toEqual(['created', 'created']);
    expect(result.files.map((f) => f.path)).toEqual([result.configPath, result.workflowPath]);
  });
});
