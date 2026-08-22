# Configuration

Warden is configured by a single `warden.config.ts` at your repository root. Every field has a documented default, so an empty config is valid — you only set what you want to change.

```ts
import { defineConfig } from '@warden/core';

export default defineConfig({
  ai: { provider: 'anthropic', model: 'claude-sonnet-5' },
  gates: { blockOnPassRateBelowPercent: 90 }, // tolerate one failure in ten
});
```

`defineConfig` validates your config and fills defaults.

## The config file is read, not run

Warden **parses** `warden.config.*` as data. It does not transpile or execute it.

The file arrives with `git clone`, and on CI that clone is the *pull request's* head — a file
written by whoever opened the PR, read by a process holding `ANTHROPIC_API_KEY`. Executing it
would hand that environment to the contributor. So the loader reads the exported literal and
refuses anything with a runtime effect.

What a config may contain:

- `export default { … }` or `module.exports = { … }`, optionally wrapped in `defineConfig(…)`
- object and array literals, quoted strings, numbers, `true` / `false` / `null` / `undefined`
- comments, trailing commas, and the type-only suffixes `as const` and `satisfies T`
- leading `import` statements (skipped — `defineConfig` is the only binding a data config needs)

What it may not: function calls, references to variables or `process.env`, template
substitutions (`` `${…}` ``), spreads, computed keys, or any statement outside the default
export. Each is a `ConfigError` naming the file, line and column — never a silent partial read.

`.ts`, `.mts`, `.cts`, `.js`, `.mjs`, `.cjs` and `.json` are resolved in that order, and
`warden.config.local.*` — useful for machine-local overrides, and normally git-ignored — is
deep-merged on top of whichever is found.

### If you need a computed config

Set `WARDEN_TRUST_CONFIG=1` and Warden evaluates the file with
[c12](https://github.com/unjs/c12)/jiti as before, lifting both this restriction and the
loopback rule below. **Only ever set it for a checkout you vouch for.** Never set it in a
workflow that runs on `pull_request`: it gives every contributor code execution inside a job
that holds your API key. `warden init` does not scaffold it, and the GitHub Action does not
set it.

## No config at all is not the same as an empty one

Warden runs without a `warden.config` — every field has a default — but the defaults are guesses
about your repository's layout and naming (`apps/` and `src/features/` modules; `auth`, `payment`,
`checkout`, `admin` as high-risk; `lib/`, `shared/`, `packages/core/` as shared paths). A repository
they do not describe scores low for the wrong reason, and it scores *identically* to a repository
whose owner wrote `export default {}` and meant it.

So Warden reports which of the two it was given, and never presents the defaults as your settings:

- `warden analyze` emits `configured=false` and warns on stderr.
- The GitHub Action sets the `configured` output, logs a warning, and adds a line to the PR
  comment and job summary.
- The GitHub App refuses a `warden.config.json` that is present but unparseable or schema-invalid
  rather than quietly substituting defaults for it. A missing one is still fine — it just runs
  unconfigured, and says so.

None of this blocks a merge on its own. `npx --yes --package=@warden/cli -- warden init` writes a config and ends it.

## Full reference

### `ai` — the AI engine

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `ai.provider` | `'anthropic' \| 'openai' \| 'gemini' \| 'ollama'` | `'anthropic'` | All available. Each cloud provider reads **only its own** key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`. Missing key → error, never a stub. |
| `ai.model` | `string` | `'claude-sonnet-5'` | Override per repo; high-risk tiers can bump to Opus. |
| `ai.fallbackProvider` | provider | — | Fall back (e.g. to local Ollama) if the primary key is missing. The supported way to run keyless. |
| `ai.ollama.baseUrl` | `string` | `'http://localhost:11434'` | Must be an `http(s)` URL. From a config file, must also be **loopback** — see below. |
| `ai.ollama.model` | `string` | `'qwen3:32b'` | |

`ai.ollama.baseUrl` is the one field that decides where prompt text goes — and prompt text is
your diff, your seeded fixture values and the live page. A config file read from the repository
under test may therefore only name a loopback host (`localhost`, `127.0.0.0/8`, `::1`, `*.localhost`);
anything else is refused with a `ConfigError` rather than quietly used.

To point Warden at a **remote** Ollama, set `WARDEN_OLLAMA_BASE_URL` in the environment. The
environment belongs to whoever runs Warden and cannot be written by a pull request, so a value
set there overrides the config file and is taken at its word:

```yaml
- run: npx --yes --package=@warden/cli -- warden agent --strategy exploratory --output report.json
  env:
    WARDEN_OLLAMA_BASE_URL: https://ollama.internal.example
```

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
| `scope.modulePaths` | `string[]` | `['apps/', 'src/features/']` |
| `scope.tagPrefix` | `string` | `'@'` |

Changes under `sharedPaths` escalate to the full suite. `highRiskPatterns` raise the risk score.

#### `scope.modulePaths` — where your modules live

This is the knob the selective tier depends on, and the defaults describe a Next-style app.
A changed file under one of these prefixes becomes a **module** named by its first two path
segments, and that module's test tag — `tagPrefix + module` — is what `warden analyze` emits
as `test_tags`:

| Changed file | `modulePaths` entry | Module | Tag |
|---|---|---|---|
| `apps/checkout/page.tsx` | `apps/` | `apps/checkout` | `@apps/checkout` |
| `src/features/auth/login.ts` | `src/features/` | `src/features` | `@src/features` |
| `crates/block-engine/src/parse.rs` | `crates/` | `crates/block-engine` | `@crates/block-engine` |

A trailing slash is optional (`internal` and `internal/` behave alike, and neither matches
`internals-notes/`). A prefix that is already two segments deep — `src/features/` above — makes
every file beneath it one module; split it into its children if you want finer tags.

**If your repo is not laid out as `apps/*` or `src/features/*`, set this.** A Rust workspace
wants `['crates/']`, a Go service `['cmd/', 'internal/']`, a Nx-style monorepo `['libs/',
'apps/']`. Left at the default in a repo that matches none of it, every diff produces
`test_tags=` and the selective tier has nothing to select — `warden analyze` writes that
observation to stderr and the GitHub Action logs it as a warning, but nothing fails, so it is
worth setting deliberately.

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

These are the rules `warden run` and `warden report aggregate` decide `BLOCK` / `WARN` / `PASS` by.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `gates.blockOnCritical` | `boolean` | `true` | A failure on a `P1` test blocks on the critical rule, ahead of the plain failure rule. |
| `gates.blockOnPassRateBelowPercent` | `number` | `90` | Block when the pass rate falls below this. `0` switches the rule off. |
| `gates.warnOnHighCount` | `number` | `2` | More than this many `P2` failures blocks on the P2 threshold rule. |
| `gates.flakeQuarantineAfterRuns` | `number` | `3` | Quarantine a flaky test after this many non-deterministic runs. |

**Pass rate** is the share of results that ended green — `PASS`, plus `FLAKY` for a test that
passed on a retry — over every result in the run. A `SKIP` and a `BLOCKED` count against it, so a
run that skipped most of its tests does not clear a threshold it never measured up to.

The floor is a bar on how much of the run produced an answer, **not** a failure allowance. Any
failing test blocks whatever the floor is set to, and any test that started and never finished
blocks too. Lowering the floor buys tolerance for skipped tests, never for red ones.

> Before v0.4.2 no code read any of these fields: the gate the CLI actually ran was hard-coded,
> and the orchestrator's configured gate was called by nothing. Setting them had no effect in
> either direction. They are live now.

#### Marking a test `P1` / `P2`

`blockOnCritical` and `warnOnHighCount` only fire on results the runner marked. Warden reads a
priority from a test's CTRF `extra.priority` (`"P1"`, `"P2"`, `"P3"`) or from a `@P1`-style tag,
which is how a Playwright suite usually carries it:

```ts
test('checkout completes @P1', async ({ page }) => { /* ... */ });
```

An unmarked test has no priority, and the priority rules pass over it rather than assuming one.
Because any failure blocks anyway, these two keys decide **which reason** is reported, not whether
a red run is caught.

### `testManagement` — traceability

| Key | Type | Default |
|-----|------|---------|
| `testManagement.requirementsSource` | `'github_issues' \| 'linear' \| 'jira' \| 'markdown'` | `'github_issues'` |
| `testManagement.testCasesDir` | `string` | `'tests/cases/'` |
| `testManagement.generatedTestsDir` | `string` | `'tests/e2e/generated/'` |
| `testManagement.commitGeneratedTests` | `boolean` | `true` |

### `plugins` — extensibility

An array of plugins implementing `QAPlatformPlugin`. Plugins can hook lifecycle events and override the provider, browser engine, or reporter.

A plugin is an object with functions on it, so it cannot be written inline in a config that is
read as data. Declare plugins through the manifest-based
[plugin registry](tier-3-guide.md#plugin-registry) instead:

```ts
export default defineConfig({
  pluginRegistry: {
    enabled: true,
    sources: [{ kind: 'dir', location: 'plugins/' }],
  },
});
```

Passing plugin objects directly in `plugins: [...]` still works for programmatic callers that
build a config with `defineConfig` in their own process, and for a config file loaded under
`WARDEN_TRUST_CONFIG=1`.

## Example: a payment-heavy app

```ts
import { defineConfig } from '@warden/core';

export default defineConfig({
  ai: { provider: 'anthropic', model: 'claude-opus-4-8' },
  scope: {
    highRiskPatterns: ['auth', 'payment', 'checkout', 'billing', 'stripe'],
    modulePaths: ['apps/', 'packages/'],
  },
  tiers: { aiExploratory: { riskThreshold: 3 } }, // explore sooner
  gates: { warnOnHighCount: 0 },                    // stricter: one P2 failure blocks
});
```
