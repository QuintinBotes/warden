# Configuration

Warden is configured by a single `warden.config.ts` at your repository root. Every field has a documented default, so an empty config is valid — you only set what you want to change.

```ts
import { defineConfig } from '@warden/core';

export default defineConfig({
  ai: { provider: 'anthropic', model: 'claude-sonnet-5' },
  gates: { blockOnPassRateBelowPercent: 90 },
});
```

`defineConfig` validates your config and fills defaults. Warden loads it with [c12](https://github.com/unjs/c12), so `.ts`, `.js`, and `.mjs` config files all work.

## Full reference

### `ai` — the AI engine

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `ai.provider` | `'anthropic' \| 'openai' \| 'gemini' \| 'ollama'` | `'anthropic'` | All available; each cloud provider reads its own API key from the environment. |
| `ai.model` | `string` | `'claude-sonnet-5'` | Override per repo; high-risk tiers can bump to Opus. |
| `ai.fallbackProvider` | provider | — | Fall back (e.g. to local Ollama) if the primary key is missing. |
| `ai.ollama.baseUrl` | `string` | `'http://localhost:11434'` | |
| `ai.ollama.model` | `string` | `'qwen3:32b'` | |

### `browser` — how the app is driven

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `browser.engine` | `'playwright' \| 'claude-chrome' \| 'stagehand'` | `'playwright'` | Playwright for headless CI; Claude-Chrome for local, real-browser runs. |
| `browser.headless` | `boolean` | `true` | |
| `browser.viewport` | `{ width, height }` | `1280×720` | |
| `browser.mobileViewport` | `{ width, height }` | `375×667` | Used for mobile checks. |
| `browser.timeout` | `number` (ms) | `30000` | |

See [Providers & Engines](providers-and-engines.md) for when to use each engine.

### `scope` — selective testing

| Key | Type | Default |
|-----|------|---------|
| `scope.highRiskPatterns` | `string[]` | `['auth', 'payment', 'checkout', 'admin']` |
| `scope.sharedPaths` | `string[]` | `['lib/', 'shared/', 'packages/core/']` |
| `scope.tagPrefix` | `string` | `'@'` |

Changes under `sharedPaths` escalate to the full suite. `highRiskPatterns` raise the risk score.

### `tiers` — when each suite runs

`tiers.smoke`, `tiers.selective`, `tiers.fullRegression`, and `tiers.aiExploratory` control triggers and budgets. The most important knob:

| Key | Default | Notes |
|-----|---------|-------|
| `tiers.aiExploratory.riskThreshold` | `4` | Risk score at which the exploratory agent runs. |
| `tiers.smoke.maxDuration` | `'3m'` | |
| `tiers.fullRegression.maxDuration` | `'30m'` | |

### `reporting` — where results go

| Key | Type | Default |
|-----|------|---------|
| `reporting.ctrf` | `boolean` | `true` |
| `reporting.githubJobSummary` | `boolean` | `true` |
| `reporting.prComment` | `boolean` | `true` |
| `reporting.checkRunAnnotations` | `boolean` | `true` |
| `reporting.prometheus.enabled` | `boolean` | `false` |
| `reporting.prometheus.pushgatewayUrl` | `string` | — |

See [Reporting](reporting.md).

### `gates` — the merge gate

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `gates.blockOnCritical` | `boolean` | `true` | Any P1 failure blocks merge. |
| `gates.blockOnPassRateBelowPercent` | `number` | `90` | Block if pass rate drops below this. |
| `gates.warnOnHighCount` | `number` | `2` | More than this many P2 failures blocks; at least one warns. |
| `gates.flakeQuarantineAfterRuns` | `number` | `3` | Quarantine a flaky test after this many non-deterministic runs. |

### `testManagement` — traceability

| Key | Type | Default |
|-----|------|---------|
| `testManagement.requirementsSource` | `'github_issues' \| 'linear' \| 'jira' \| 'markdown'` | `'github_issues'` |
| `testManagement.testCasesDir` | `string` | `'tests/cases/'` |
| `testManagement.generatedTestsDir` | `string` | `'tests/e2e/generated/'` |
| `testManagement.commitGeneratedTests` | `boolean` | `true` |

### `plugins` — extensibility

An array of plugins implementing `QAPlatformPlugin`. Plugins can hook lifecycle events and override the provider, browser engine, or reporter.

```ts
export default defineConfig({
  plugins: [
    // slackPlugin({ webhookUrl: process.env.SLACK_WEBHOOK }),
  ],
});
```

## Example: a payment-heavy app

```ts
import { defineConfig } from '@warden/core';

export default defineConfig({
  ai: { provider: 'anthropic', model: 'claude-opus-4-8' },
  scope: {
    highRiskPatterns: ['auth', 'payment', 'checkout', 'billing', 'stripe'],
  },
  tiers: { aiExploratory: { riskThreshold: 3 } }, // explore sooner
  gates: { blockOnPassRateBelowPercent: 95 },       // stricter gate
});
```
