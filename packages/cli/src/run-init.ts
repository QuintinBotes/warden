import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Options for {@link runInit}. */
export interface RunInitOptions {
  /** Directory to scaffold `warden.config.ts` and `.github/workflows/ai-qa.yml` into. */
  cwd: string;
}

/** Return value of {@link runInit}. */
export interface RunInitResult {
  configPath: string;
  workflowPath: string;
}

const CONFIG_TEMPLATE = `/**
 * Warden configuration. Every field is optional and has a sensible default, so you can
 * delete anything you don't need. Full reference:
 * https://github.com/QuintinBotes/warden/blob/main/docs/configuration.md
 *
 * This starter is import-free so it works immediately, even via \`npx warden\`. Once you've
 * added @warden/cli as a dependency you can switch to the typed helper:
 *
 *   import { defineConfig } from '@warden/core';
 *   export default defineConfig({ ... });
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
    blockOnPassRateBelowPercent: 90,
  },
};
`;

const WORKFLOW_TEMPLATE = `name: AI QA

on:
  pull_request:

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx warden run --grep "@smoke" --artifacts-dir warden-artifacts/smoke

  analyze:
    needs: smoke
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
        run: npx warden analyze --base "\${{ github.event.pull_request.base.sha }}" --head "\${{ github.sha }}" --output "$GITHUB_OUTPUT"

  selective:
    needs: analyze
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx warden run --grep "\${{ needs.analyze.outputs.test_tags }}" --artifacts-dir warden-artifacts/selective

  exploratory:
    needs: analyze
    if: fromJson(needs.analyze.outputs.risk_score) >= 4
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx warden agent --strategy exploratory --url "\${{ vars.PREVIEW_URL }}" --pr-number "\${{ github.event.pull_request.number }}" --output warden-artifacts/exploratory-report.json
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}

  qa-gate:
    needs: [selective, exploratory]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx warden report aggregate --reports warden-artifacts --pr "\${{ github.event.pull_request.number }}"
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

/**
 * Scaffolds a starter `warden.config.ts` (import-free, so it loads even before deps are
 * installed) and a sample tiered
 * `.github/workflows/ai-qa.yml` (smoke → analyze → selective/exploratory → gate, per blueprint
 * Part IV) into `opts.cwd` — the `create-warden-config` onboarding story.
 */
export async function runInit(opts: RunInitOptions): Promise<RunInitResult> {
  const configPath = path.join(opts.cwd, 'warden.config.ts');
  const workflowDir = path.join(opts.cwd, '.github', 'workflows');
  const workflowPath = path.join(workflowDir, 'ai-qa.yml');

  await fs.mkdir(workflowDir, { recursive: true });
  await fs.writeFile(configPath, CONFIG_TEMPLATE, 'utf-8');
  await fs.writeFile(workflowPath, WORKFLOW_TEMPLATE, 'utf-8');

  return { configPath, workflowPath };
}
