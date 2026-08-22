# Getting Started

The goal: a developer with no QA background opens a pull request and sees their first AI QA report within ten minutes.

## Prerequisites

- A GitHub repository with a web app or API that can start in CI.
- An [Anthropic API key](https://console.anthropic.com/) (Claude is the default engine).
- Node.js 20+ and pnpm 10+, to build the CLI.

## 0. Build the CLI

`@warden/cli` is not on npm yet, so there is no one-line install: `npm install @warden/cli`
and every `npx` form of it return a 404. Build it from source once — it takes a couple of
minutes, and it is the same build this repository's own QA workflow runs:

```bash
git clone https://github.com/QuintinBotes/warden.git
cd warden
pnpm install --frozen-lockfile
pnpm -w build
```

The commands below are written as `warden <subcommand>`. Either alias that to the build —

```bash
alias warden="node /path/to/warden/packages/cli/dist/bin/warden.js"
```

— or spell it out as `node /path/to/warden/packages/cli/dist/bin/warden.js <subcommand>`. Full
detail, and what the invocation will be once the package is published, is in the
[CLI Reference](cli.md#installing).

Whatever you do, don't run `npx warden`: the unscoped name `warden` on npm is an unrelated
package from 2014 with no executable in it, so npx downloads a stranger's code and then fails.

## 1. Add the workflow

Create `.github/workflows/ai-qa.yml` in your repo. The fastest way is to scaffold it:

```bash
warden init
```

`warden init` writes two files into your repo:

- `warden.config.ts` — your configuration (safe, sensible defaults). Warden parses this file as data and never executes it, so keep it to literal values; see [Configuration](configuration.md#the-config-file-is-read-not-run).
- `.github/workflows/ai-qa.yml` — the tiered QA workflow.

Each tier in that workflow is a separate job on its own runner, so the workflow uploads
every tier's CTRF report as a `warden-ctrf-*` artifact and the final `qa-gate` job
downloads them all back before aggregating. If you rearrange the jobs, keep that pairing:
a tier whose report is never uploaded is invisible to the gate, and a gate with nothing to
read reports "no tests ran" rather than blocking. The scaffolded gate refuses to pass when
its download came back empty, for exactly that reason.

The workflow also declares `pull-requests: write` and `checks: write`; without them the
gate cannot post its comment or check run.

Re-running it later is safe. Once you have edited either file, `init` asks before replacing it and
keeps it if you say no — or if nothing can be asked, as in CI or under a pipe. Pass `--force` when
you do want the templates back. See [`warden init`](cli.md#warden-init).

Each CLI step in that workflow is written as `npx --yes --package=@warden/cli -- warden …`,
which is the form that will work once the package ships. **Until then those steps fail on the
runner with a 404** — the scaffolded file says so in a comment at the top, and points at the
alternative: build the CLI in a step of your own and call
`node <path>/packages/cli/dist/bin/warden.js` instead. Nothing about that failure is silent,
and no other package is downloaded in Warden's name.

Prefer to copy it by hand? See the full reference workflow in the [GitHub Action guide](github-action.md).
If you adapt it, keep one shape intact: values a pull request can influence — `test_tags` above
all — reach a command through an `env:` variable read as `"$VAR"`, never through `${{ … }}`
spliced into the script. [Untrusted values in a `run:` step](github-action.md#untrusted-values-in-a-run-step)
explains why.

Warden also runs with no config at all, but it will say so: `warden analyze` emits
`configured=false`, and the Action's PR comment records that the risk score and the tiers that ran
came from built-in defaults rather than from this repository. See
[No config at all is not the same as an empty one](configuration.md#no-config-at-all-is-not-the-same-as-an-empty-one).

## 2. Add your API key

In your repository: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | your Anthropic key |

Warden reads this from the workflow; it is never written to disk or logs.

Using a different model? Set `ai.provider` in `warden.config.ts` and add that provider's own
secret — `OPENAI_API_KEY`, or `GEMINI_API_KEY`/`GOOGLE_API_KEY`. Warden reads only the variable
belonging to the provider you configured; if it is missing the agent step fails rather than
running a stub. See [AI Providers & Browser Engines](providers-and-engines.md).

## 3. Open a pull request

That's it. On the next PR, Warden will:

1. **Analyze** the diff — compute the change surface, derive test tags, and score risk.
2. **Run** the right tiers — smoke always; selective regression scoped to the changed modules; the AI exploratory agent when risk crosses your threshold.

> **Scoping needs to know your layout.** "The changed modules" means files under
> `scope.modulePaths`, which defaults to `['apps/', 'src/features/']`. If your code lives
> somewhere else — `crates/`, `cmd/`, `libs/`, `services/` — set it in `warden.config.ts` or the
> selective tier will find no tags and fall back to re-running smoke. `warden analyze` prints a
> line to stderr, and the Action logs a warning, whenever that happens. See
> [Configuration](configuration.md#scopemodulepaths--where-your-modules-live).
3. **Report** back in four places — a GitHub Job Summary, a PR review comment, inline check-run annotations, and a machine-readable CTRF file.
4. **Gate** the merge — block on critical failures, warn on high, pass when your exit criteria are met.

Within a few minutes you'll see a comment like:

```
## 🤖 AI QA Report — PR #123
Risk Score: 7/10 (HIGH — payment flow changed)
Test Coverage: 44/47 tests passing ✅

🐛 Bugs Found (2)
🚦 QA Gate Decision: ❌ BLOCK MERGE
```

## What "risk" controls

Warden scales its effort to the blast radius of your change:

| Risk score | Tiers that run |
|-----------|----------------|
| 0–3 | Smoke + selective regression |
| 4–6 | Smoke + full regression + AI exploratory |
| 7–10 | Smoke + full regression + AI exploratory + notify human QA |
| unknown | Smoke + full regression + AI exploratory — the diff could not be read, so nothing was scoped and nothing was ruled out |

Changes touching `auth`, `payment`, `checkout`, or shared infrastructure score higher automatically. Tune the rules in [Configuration](configuration.md).

A risk of **unknown** is not a risk of 0. It means `warden analyze` could not read the diff —
almost always a shallow checkout, since `actions/checkout` defaults to `fetch-depth: 1` and a
depth-1 clone does not contain the PR's base commit. Warden says `unknown` on every surface and
runs the widest pipeline it has; the fix is [`fetch-depth: 0`](github-action.md#fetch-depth-0-is-required).

## Run it locally

You don't need CI to try Warden. Point the CLI at a running preview:

```bash
# analyze what a branch changed
warden analyze --base origin/main --head HEAD

# run the exploratory agent against a local app
warden agent --strategy exploratory --url http://localhost:3000 --output report.json

# run the test tiers + gate, writing a CTRF report and a job summary
warden run --grep @smoke --artifacts-dir warden-artifacts
```

`warden run` drives the Playwright test runner, so your repo needs `@playwright/test`
installed (and its browsers — `npx playwright install`). Warden runs the Playwright your
project installed and **never downloads one**: it looks for `node_modules/.bin/playwright`
in the working directory and every parent, and a repo without it fails the run with a
message saying what to install, exiting non-zero. That is deliberate — fetching Playwright
on demand would run it against a repo with no Playwright config and no specs, and the
empty report that came back would read as "no tests ran" and let the job go green having
tested nothing. If your Playwright lives outside the project (a global install, or a
container image that ships one), point `WARDEN_PLAYWRIGHT_BIN` at the CLI.

Outside CI there's no GitHub client, so Warden skips the PR comment and check-run
annotations (logging a warning for each) and writes the job summary to
`warden-artifacts/job-summary.md` instead of the Actions summary — the run still produces
the CTRF report and computes the merge gate.

That gate is the last line of output and the command's exit status: `warden run` prints
`gate: <decision> — <reason>` (`gate: BLOCK — 1 test(s) failed`) as its last line and exits `1`
when the decision is `BLOCK`, so a bare `warden run` step fails its CI job on a red tier. `PASS`
and `WARN` exit `0`. See [Exit codes](cli.md#exit-codes).

`warden agent` needs a key for whichever provider `ai.provider` names — `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `GEMINI_API_KEY`/`GOOGLE_API_KEY`. Without one it exits `1` and writes no
report, rather than stubbing the model: a stubbed run is indistinguishable from a real run that
found no bugs. Set `ai.fallbackProvider: 'ollama'` to run against a local model instead, or pass
`--stub-provider` to exercise the wiring — that run labels itself as having called nothing. See
the [CLI Reference](cli.md).

## Next steps

- Tune scope and gates in [Configuration](configuration.md).
- Understand the tiers and surfaces in [Architecture](architecture.md) and [Reporting](reporting.md).
- Self-host the dashboard and metrics stack in [Deployment](deployment.md).
