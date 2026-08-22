# Changelog

All notable changes to Warden are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`warden run` exits `1` when the gate blocks.** The command computed a gate decision and threw
  it away: Playwright's non-zero exit is discarded on purpose (the JSON report is needed from a red
  run too), and nothing downstream looked at the decision, so `warden run` exited `0` whether the
  tier was green, entirely red, or produced no tests at all. In the workflow `warden init`
  scaffolds, the `smoke` and `selective` jobs are bare `npx warden run` steps — made required
  checks, they went green over a suite that failed. `run` now prints `gate: <decision> — <reason>`
  as its last line and exits `1` on `BLOCK`; `PASS` and `WARN` still exit `0`, matching the
  exit-code table that was already documented in [docs/cli.md](docs/cli.md).
- **`warden report aggregate` exits `1` when the gate blocks.** It printed `gate: BLOCK — …` and
  returned `0`, so the one gating job in the workflow `warden init` scaffolds — whose only step is
  this command — went green on a blocked gate. `docs/cli.md` has documented `1` = "gate decision
  BLOCK" all along; now the command does it, on both the GitHub and the `VcsProvider` path. The
  exit code is derived in `runReport` (`RunReportResult.exitCode`) rather than in the Commander
  action, so a test covers it.
- **The GitHub path creates the `Warden QA` check run again.** `runReport` built only a
  `PrCommentReporter`: no check run and no commit status was created on GitHub even though
  `reporting.checkRunAnnotations` defaults to `true`. A required check therefore stayed green
  beside a PR comment reading "QA Gate: ⛔ BLOCK". The check run is now created when
  `reporting.checkRunAnnotations` is on and a head SHA is known (`$GITHUB_SHA` in Actions);
  without a head SHA it is skipped rather than attached to a guessed commit, and the non-zero
  exit code remains the guard. The non-GitHub `VcsProvider` path already posted a `failure`
  status and is unchanged.
- **The merge gate now actually fails the CI step.** `warden run` and `warden report aggregate`
  both computed a gate decision, printed or rendered it, and then exited `0` — including on
  `BLOCK`. `docs/cli.md` documented exit `1` for a blocking gate and told adopters to fail a CI
  step on it, so the workflow `warden init` scaffolds shipped a QA gate that reported BLOCK in a
  green CI. `process.exitCode` was only ever set from the CLI's error handler, which a blocking
  gate never reaches. Both commands now map the decision through one place
  (`packages/cli/src/gate-exit.ts`): `BLOCK` → `1`, `PASS`/`WARN` → `0`, and never downward, so a
  passing gate cannot clear an exit code an earlier failure set. `warden run` also prints its gate
  line (`gate: BLOCK — 1 test(s) failed`) — a step that fails with "wrote CTRF report to …" as its
  last word gives no reason for failing.
- **A Playwright run that was interrupted no longer reports "All tests passed".** Playwright marks
  every unfinished test `interrupted` when a run is cut short — `--max-failures` tripped, the
  global timeout hit, or the process took SIGINT/SIGTERM from a cancelled or timed-out CI job.
  The Playwright→CTRF converter had no case for it, so it fell through to CTRF `other`, which the
  CLI mapped to `SKIP`; one surviving passing test then carried the whole gate and the PR comment
  read `PASS — All tests passed` for a run in which the payment test never finished. Nothing in
  the CTRF, the comment or the check output recorded that anything had been interrupted.
  - `interrupted` now maps to CTRF `pending` — "started, never finished" — which the CLI already
    maps to `BLOCKED`. The summary counts it under `pending`, and every report surface shows the
    test as `BLOCKED` rather than as a skip the author chose.
  - `computeGateDecision` now `BLOCK`s with `N test(s) did not finish` whenever any result is
    `BLOCKED`, instead of letting a single pass carry the gate. This supersedes the 0.4.1 rule
    below, under which a blocked test only reached `WARN "no tests passed"` and only when nothing
    passed at all: an unknown result is not evidence of a green build, so it fails closed.
    A run in which everything was *skipped* still `WARN`s — that path is unchanged.
- **A test tier that crashes no longer passes the gate on whichever tiers survived.** The Action
  ran each tier through a helper that turned any failure into one `core.warning` line "so the gate
  still runs" — but a tier that dies (browser OOM-killed, preview URL down, `npx` install failure,
  runner eviction) writes no CTRF file, so `warden report aggregate` scored only the tiers that
  did write one. A dead regression tier — the one selected to cover the diff — left the smoke
  tier's results to produce `PASS`, a `success` check run and a green required check, with the
  loss recorded nowhere but a collapsed log group. Tiers that do not complete are now recorded and
  the gate fails **closed** to `BLOCK`, naming each lost tier and its error in the gate reason, the
  check-run title, the job summary and the PR comment; the step fails; and a new `incomplete-tiers`
  action output lists them.
- **The `gates` config is now the gate.** Every field under `gates` in `warden.config.ts` was
  dead. `evaluateExitCriteria` was the only function that read `blockOnCritical`,
  `blockOnPassRateBelowPercent` or `warnOnHighCount`, and nothing in the product called it — the
  gate `warden run` and `warden report aggregate` actually published was `computeGateDecision`,
  which read no config at all and blocked on any failure. Setting a threshold had no effect in
  either direction: a repo that loosened the gate deliberately still got a `BLOCK`, and a repo
  that tightened it got no extra enforcement.

  Both names now delegate to one implementation, `evaluateGate` in `@warden/core`, which every
  caller hands the configured policy — `warden run`, `warden report aggregate`, and all five
  reporters (PR comment, check run, job summary, and the two multi-SCM ones), so the gate on the
  comment and the gate in the exit code cannot disagree.
- **The merge gate now reads the `gates` thresholds it documents.** Every verdict Warden posts —
  the PR comment, the check run, the commit status, the job summary, `warden run`'s exit code and
  `warden report aggregate` — comes from `computeGateDecision`, which took no `WardenConfig` and
  applied fixed rules. The only reader of `gates.blockOnPassRateBelowPercent` was
  `evaluateExitCriteria`, which nothing outside its own tests called. The documented default (90)
  and the `warden init` template shipped it set, and it blocked nothing.

  The two disagreed exactly where it mattered: a run whose tests were nearly all skipped — a
  `--grep` that matched almost nothing, a suite that bailed early, a fixture that skipped the rest
  — had a pass rate the configured gate blocks on, and the real gate called it
  `PASS "All tests passed"`. `computeGateDecision(execution, cfg)` now takes the config (required,
  so the compiler catches the next caller that would skip it) and both gates evaluate the rule
  through one shared implementation, `evaluatePassRateGate` in `@warden/core`.

  Pass rate is the share of results that ended green (`PASS` + `FLAKY`, a test that passed on
  retry) over every result; `SKIP` and `BLOCKED` count against it. Flakiness keeps its own gates
  (`flake.gate`, `gates.flakeQuarantineAfterRuns`) rather than being charged twice.

  **This can newly block a merge** that previously passed: a run under your configured pass rate
  now BLOCKs. Set `gates.blockOnPassRateBelowPercent: 0` to restore the previous behaviour.
  `blockOnCritical` and `warnOnHighCount` are graded by test-case priority, which a result does not
  carry, and remain unenforced on the PR path — the gate blocks on any failure, which is stricter
  than both. `docs/reporting.md` and `docs/configuration.md` now say so.
- **The PR comment and check run now publish the run's final gate, not a stale tests-only one.**
  `warden run` invoked every reporter *before* folding in the flake-quarantine WARN, the
  accessibility and performance-budget gates, and the CUJ gate, and each reporter derived its own
  verdict from the test results alone. A run where every test passed but an a11y violation, a
  performance-budget breach or a degraded critical user journey blocked the merge posted
  `conclusion: success` / `✅ PASS` on the PR while `runRun` returned `BLOCK` — the worst-of merge
  was real, but invisible on the only surfaces a reviewer looks at. Reporters now run last, after
  every tier is folded in, and are handed the final decision on `ReportContext.gate`.
- **Security: the scaffolded `ai-qa.yml` handed the code it was auditing a shell.** `warden init`
  wrote a `pull_request` workflow whose selective tier ran
  `npx warden run --grep "${{ needs.analyze.outputs.test_tags }}"`. GitHub substitutes `${{ … }}`
  into a `run:` script as text before the shell parses it, and a test tag is `tagPrefix` plus the
  first two segments of a changed file's own path — so a pull request adding a file under
  `apps/$(…)/` executed that command on the runner, with the workflow's token and secrets in
  reach. Every expression a scaffolded step needs is now bound to an `env:` variable and read as
  `"$VAR"`, which the shell does not re-scan. The same fix is applied to the shipped
  `ai-qa.example.yml` and to Warden's own `warden-selftest.yml`, which had the identical hole.
  `packages/cli/src/workflow-injection.test.ts` parses each of those workflows and fails if a
  `${{ … }}` ever reappears inside a `run:` script. Verified end to end: the payload that
  previously created a file on the runner now arrives as one literal `--grep` argument.
  Anyone who ran `warden init` before this release should re-scaffold or apply the `env:` change
  by hand.
- **An agent-proposed patch is no longer committed as the file itself.** Both publishers handed a
  unified diff to `GitHubAccess.openOrUpdateDraftPr`, whose GitHub implementation base64-encodes
  what it is given and PUTs it to the contents API — a whole-file write. A proactive-heal draft PR
  therefore replaced the spec it was healing (`tests/e2e/checkout.spec.ts` and everything in it)
  with five lines of `--- a/… +++ b/… @@` text, and a coverage-sync `update` did the same to a file
  in a *different* repository. Warden now applies the patch to the target file and commits the
  resulting file, via one strict applier in `@warden/core` (`applyUnifiedDiff`): context must match
  exactly, a hunk matching two places is refused rather than guessed at, and a patch that will not
  apply is **not committed at all** — it is named, with its reason, on the check-run and in the
  draft-PR body.
- **A locator repair patch is now built from the real source line**, not a reconstruction of the
  call: `LocatorRef` carries the `sourceLine` the extractor read, so the diff in the draft PR is one
  that actually applies to the file it targets.
- **A retry round now re-runs the tests that actually failed.** `warden run` built the retry
  `--grep` by joining the failing tests' raw titles with `|`, and Playwright compiles `--grep` as a
  regex — so any metacharacter in a title changed what it matched. `checkout [beta] applies coupon`
  became a character class and matched nothing, leaving the retry to re-run the wrong set while the
  flake-intelligence pass measured a test it had not retried; an unbalanced `[` or `(` was not a
  valid regex at all and took the whole tier down with a non-zero exit. Titles are now
  regex-escaped before they are joined, through the same single `escapeRegExp` in `@warden/core`
  that impact analysis' `--grep` already used. A user-supplied `warden run --grep` is unchanged —
  that one is still a regex you write on purpose.
- **The GitHub Action can read the CLI's gate again — every PR no longer fails closed to
  `BLOCK`.** The Action shells `warden report aggregate` and parsed its stdout as a JSON gate
  report, but that command's only stdout was the human line `gate: PASS — All tests passed`. The
  parse threw `AGGREGATE_PARSE_ERROR` on every run, and the fail-closed rule added in 0.4.1
  correctly turned that into `BLOCK` — so the shipped Action blocked every pull request whatever
  the tests did, and blamed aggregation rather than the contract mismatch. The two sides never
  disagreed in CI because the Action's own tests fed the parser a shape the real CLI never
  produced.
  - `warden report aggregate --json` now prints the machine-readable gate report on stdout (the
    human line moves to stderr). Without `--json` the output is unchanged.
  - The shape is defined once, as `GateReport` in `@warden/core`, and imported by both the CLI
    that writes it and the Action that reads it, so the next drift is a type error.
  - A contract test spawns the built CLI and feeds its real stdout to the Action's real parser.
  - When the report still cannot be read, the message now names the mismatch (a `warden` on PATH
    older than the Action) instead of blaming aggregation.
- **The GitHub Action could not execute a single CLI step.** Every tier the Action ran was
  rejected by `warden` before it started, and the gate then crashed on the aggregate step.
  Three separate contract breaks between the Action and the CLI it shells out to:
  - `warden run` was called with `--output <file>`, an option it did not have. `--output` now
    exists, and writes the CTRF report to that exact path instead of
    `<artifacts-dir>/ctrf-report.json` — which is what lets several tiers land side by side in
    one directory for `warden report aggregate` to merge.
  - `warden agent` was called with `--provider` and `--model`, neither of which existed; the
    Action's `provider`/`model` inputs reached the CLI as environment variables nothing read,
    so choosing a provider did nothing. Both flags now exist and override `ai.provider` /
    `ai.model` for that run. An unrecognized provider name is an error, not a silent
    fall-through to the configured one.
  - `warden report aggregate` printed only `gate: PASS — All tests passed`, which the Action
    parsed as JSON. It now takes `--json` and prints the whole gate report — decision, reason,
    counts, and the failing tests the check run annotates. The human one-liner is unchanged
    without the flag.

  Also on that path: the Action wrote the agent's `exploratory.json` into the same directory it
  then asked `report aggregate` to merge, where every `*.json` is parsed as a CTRF report. Agent
  output and per-tier artifacts now go to `warden-artifacts/` (`WARDEN_ARTIFACTS_DIR`), leaving
  `warden-reports/` (`WARDEN_REPORTS_DIR`) to tier reports only.

  The direction of all four was fail-closed — the shipped Action blocked every PR with
  "aggregate failed" rather than passing one wrongly — but a check that blocks unconditionally
  is a check people switch off. Nothing asserted the contract: the Action's tests faked `exec`
  with a stub that accepted any argv. `buildProgram()` is now exported from `@warden/cli`, and
  `packages/github-action/src/cli-contract.test.ts` parses the argv the Action really emits with
  the CLI's own Commander parser, so a flag that stops existing fails a test instead of a merge.
- **The GitHub Action now invokes the CLI with flags the CLI defines.** Every test tier and the
  AI agent tier were passing options `warden` has never had — `run --output`, `agent --provider`,
  `agent --model` — so Commander rejected the argv and exited 1 before anything ran. `run.ts`
  wraps each tier in a helper that downgrades a failure to `core.warning(...)`, so the pipeline
  carried on and the gate was evaluated over an empty reports directory: no CTRF written, no
  agent report, and nothing said beyond three warnings. Fixed on both sides of the contract:
  - `warden run` gains `--output <file>`, an explicit CTRF path (default unchanged:
    `<artifacts-dir>/ctrf-report.json`). Several tiers aggregating into one
    `report aggregate --reports` directory each need a distinct report name; without it they
    would all write the same file and the last would win.
  - `warden agent` gains `--provider <name>` and `--model <id>`, overriding `ai.provider` and
    `ai.model` for that run. The Action's `provider` and `model` inputs had no route into the CLI
    at all — it exported them as `WARDEN_PROVIDER`/`WARDEN_MODEL`, which nothing reads. An
    unrecognized provider name is now an error rather than a silent fall back to the configured
    one.
  - The Action passes `--artifacts-dir` per tier, so each tier's screenshots, videos and traces
    stay in their own subdirectory while only the CTRF reports sit in the directory the gate
    aggregates.
- **The GitHub Action's AI exploratory tier could never run, and the PR comment said it found
  nothing anyway.** The Action appended `--provider <name>` (and `--model <id>`) to `warden agent`,
  but the CLI's `agent` command declared neither, so commander exited 1 with
  `error: unknown option '--provider'` before a single request was made. The tier's failure was
  downgraded to a `core.warning`, and the report — which took no input about whether the agent had
  run — published "🐛 Bugs Found (0) / No bugs found by the AI exploratory agent ✅" to the PR
  comment, the job summary and the check run regardless. Two changes:
  - `warden agent` now declares `--provider` and `--model` and applies them over `ai.provider` /
    `ai.model` for that run (`--model` also reaches `ai.ollama.model` when the provider is
    `ollama`). An unrecognised provider name is refused by name — it never silently falls back to
    the configured one. `AI_PROVIDERS` is exported from `@warden/core` so the accepted names are
    one list rather than a copy that can fall behind the schema.
  - `renderPrReport` now takes the tier's outcome. "No bugs found by the AI exploratory agent ✅"
    is printed only for a run that completed; a skipped or failed tier renders
    `🐛 Bugs Found (not measured)` with the reason, and an outcome the caller could not record
    makes no bug claim at all.

  Caught by a contract test that hands the exact argv the Action builds to the real built CLI as a
  subprocess — the fake `exec` the Action's unit tests inject never reaches commander, which is why
  this shipped in the first place.
- **`warden agent` no longer swaps in a stub provider, and a run that never happened no longer
  reports a clean result.** The CLI chose its provider with
  `process.env.ANTHROPIC_API_KEY ? createProvider(cfg.ai) : fakeProvider()`. That one variable
  decided two wrong things. With no key at all the agent silently did not run; and a repo
  configured for `openai`, `gemini` or `ollama` was stubbed *even with its own key set*, because
  `createProvider` — which reads the right variable and already supports all four providers —
  was never reached. Either way the command wrote an `AgentOutput` and exited `0`: exploratory
  reported "No issues were found during exploration.", and generative wrote a spec whose entire
  body was the literal string `FAKE_RESPONSE`. A refusal was byte-indistinguishable from a
  successful clean run — the false-green class 0.4.1 was released to remove.
  - `createProvider` now throws a `ProviderError` when the provider it resolves to has no
    credentials and no injected client, naming the variable to set (`OPENAI_API_KEY`,
    `GEMINI_API_KEY`/`GOOGLE_API_KEY`, …) and pointing at `ollama` as the keyless route. The
    real SDK clients are constructed lazily, so previously the first sign of a missing key was a
    request failure deep inside a strategy.
  - `warden agent` exits `1` and writes **no** report when credentials are missing. The refusal
    happens before the browser is launched, so an uncredentialed exploratory run starts nothing.
  - `AgentOutput.provider` records what produced the report — `"anthropic"`, `"openai"`,
    `"gemini"`, `"ollama"`, or `"stub"` — and the stdout line names it:
    `wrote agent report to report.json (provider: anthropic)`.
  - The keyless smoke test survives as an opt-in `--stub-provider` flag, which warns on stderr,
    sets `provider: "stub"`, and opens `markdownReport` with a banner saying no model was called.
    It no longer reaches for `fakeProvider()` from `@warden/core/testing`; the shipped CLI
    importing a test double is how the substitution stayed invisible.
- **A diff Warden could not read is reported as `unknown`, not as risk 0.** `warden analyze` shells
  `git diff <base> <head>`, which cannot run under `actions/checkout`'s default `fetch-depth: 1`:
  a depth-1 clone does not contain the PR's base commit. The Action caught that failure and read
  every downstream decision off defaults — risk `0`, no tags, no full suite — so the diff-scoped
  regression tier fell back to `@smoke` (already run, so nothing scoped to the change ran at all),
  the exploratory agent was skipped as "below threshold", and the PR comment reported
  **"Risk Score: 0/10 (LOW)"** for a change nobody had measured. An absent measurement now stays
  absent: the `risk-score` output reads `unknown`, the PR comment, job summary and check-run all
  say `Risk Score: unknown` above a banner naming the error and the `fetch-depth: 0` remedy, the
  regression tier escalates to the full `@regression` suite, and the AI exploratory agent runs
  regardless of the threshold — an unknown risk is not a risk below it. A `warden analyze` that
  completes but reports no (or an unreadable) `risk_score` takes the same path.
- **The workflow `warden init` scaffolds can now actually block a merge.** Three breakages
  compounded into a gate that was structurally incapable of failing, and said nothing about it.
  The tier jobs wrote CTRF to `warden-artifacts/smoke` and `warden-artifacts/selective`, but
  nothing uploaded it and nothing downloaded it — so on the `qa-gate` runner, which is a fresh
  machine, `warden-artifacts` did not exist at all. Even where it did, `warden report aggregate`
  read a single directory level and kept only `*.json`, silently discarding the per-tier
  subdirectories. The result was zero reports, which aggregates to `WARN "no tests ran"` and
  exits `0`: a green check on a PR whose tests failed.
  - `aggregate` now walks `--reports` recursively, so a report nested by `--artifacts-dir` or by
    `actions/download-artifact` (which unpacks each artifact into a directory of its own) is
    found. Symlinked directories are skipped rather than followed, so a cycle cannot hang the
    gate.
  - The scaffolded workflow uploads each tier's CTRF as `warden-ctrf-<tier>` with
    `if-no-files-found: error`, and the gate downloads `warden-ctrf-*` into the directory it
    aggregates. `warden agent` now writes its `AgentOutput` to `warden-agent/` and uploads it
    under a name the gate's pattern deliberately does not match — it is not CTRF, it would not
    parse, and it does not contribute to the merge decision.
  - The gate job fails if the download came back empty, rather than passing a gate that measured
    nothing.
  - The scaffolded workflow now declares the `pull-requests: write` and `checks: write`
    permissions its own gate step needs.
- **`warden run` and `warden report aggregate` exit `1` when the gate BLOCKs.** The CLI reference
  has documented that contract since 0.1 — "`1` — Gate decision `BLOCK`… use the exit code to fail
  a CI step when the gate blocks" — and neither command implemented it. `report aggregate` printed
  `gate: BLOCK` and returned `0`; `run` never looked at its gate at all. Any CI step following the
  documented pattern was a permanent green: the gate blocked, the PR comment said so, and the step
  that was supposed to enforce it passed. `run` now also prints the decision it exited on, so a
  non-zero exit says why. `PASS`/`WARN` leave the code alone rather than writing a `0` over an
  error that had already been recorded.
- **The GitHub Action reads a blocked run instead of calling it a crashed one.** Now that a BLOCK
  exits `1`, the Action's `execFile` wrapper would have rejected on every blocked PR — reporting
  "aggregate failed — gate not evaluated" in place of the real reason, and "tier failed" for a tier
  whose tests merely failed. A non-zero exit that printed a gate line is now read as the result it
  is; one that printed no gate line is still a crash, so the fail-closed behaviour 0.4.1 added is
  unchanged.
- **An absent `warden.config` is no longer reported as a configured repository.** Every field has
  a default, so a repository with no config produced byte-identical output to one containing
  `export default {}` — same risk score, same tier selection, same green check — and nothing on
  any surface said which one it was. `loadConfig` had the distinguishing signal (c12 returns the
  resolved config path, or the bare lookup name when nothing resolved) and discarded it.
  - `@warden/core` gains `loadConfigWithSource()`, returning `{ config, sourcePath, configured }`.
    `loadConfig()` is unchanged for callers that do not report a verdict.
  - `warden analyze` emits a fourth output line, `configured=true|false`, and warns on stderr when
    it is false. Consumers parsing the first three lines are unaffected.
  - The GitHub Action sets a `configured` output, logs a warning, and adds a provenance note to
    the PR comment and job summary. The gate decision is deliberately **not** changed: tests that
    passed still pass, and no currently-green merge is newly blocked. What changes is that a green
    check on an unconfigured repository now says it is one. An older CLI that emits no
    `configured` line leaves the output unset — unknown is not the same claim as `false`.
  - The GitHub App's `loadRepoConfig` no longer collapses absent, unparseable and schema-invalid
    into the same defaults: an absent config runs unconfigured (and warns), while a present but
    broken one throws `ConfigError` instead of silently running the pipeline on settings the
    repository never wrote.
- **Selective testing no longer fails silently outside an `apps/`/`src/features/` layout.** The
  module regex was a constant with no config knob, so every diff in such a repo produced
  `changedModules: []` and `test_tags=` — and the scaffolded workflow's
  `warden run --grep ""` drops an empty `--grep`, so the "selective" job ran the *whole* suite
  while reporting as scoped. Besides the new knob, a change surface that matched nothing now
  carries a `scopeWarning`: `warden analyze` writes it to stderr, and the GitHub Action logs a
  `core.warning` before the regression tier falls back to re-running `@smoke`.
- **`warden run` no longer downloads Playwright behind your back, and no longer goes green having
  tested nothing.** The runner shelled out to `npx playwright test`, and `npm exec` cannot prompt
  in CI or any other non-TTY invocation — so a repo with no `@playwright/test` anywhere in it had
  the whole package fetched from the registry unasked, run against a directory with no Playwright
  config and no specs, and the resulting zero-test JSON written out as a CTRF report with an empty
  `tests` array. The gate read that as WARN "no tests ran" and the command exited `0`: an
  unrequested network install and a CI step that passed having verified nothing. Warden now
  launches the Playwright the project installed — the nearest `node_modules/.bin/playwright` at or
  above the working directory, so a workspace-root install serves every package — and a project
  with none gets a `BrowserError` naming the directory searched and what to install, with a
  non-zero exit and no CTRF report written.
- **`warden init` no longer overwrites a config or workflow you have customized.** `init` did two
  unconditional writes — no existence check, no prompt, no flag — so re-running it after a version
  bump, which the getting-started flow encourages, replaced a tuned `warden.config.ts` and a
  hand-edited `.github/workflows/ai-qa.yml` with the starter templates and exited `0` with nothing
  said. `docs/cli.md` had promised the opposite since the command shipped. A file that exists and
  differs from the template is now only replaced when a terminal confirms it (`Overwrite? [y/N]`,
  default no) or `--force` is passed; otherwise it is reported `kept` and left alone. Each file is
  decided separately, a file already identical to the template is reported `unchanged` and never
  prompted about, and with input redirected — CI, a pipe, `< /dev/null` — there is nobody to ask,
  so nothing is replaced. Closing the prompt with Ctrl+D, or an input stream that ends under it,
  answers no instead of crashing or hanging.
- **`warden report aggregate` no longer crashes on the artifacts directory it is scaffolded to
  read.** Aggregation parsed every `*.json` under `--reports` as a CTRF report, so the agent
  report the `warden init` workflow writes to `warden-artifacts/exploratory-report.json` — and
  the `fixture-catalog.json` written by `warden run` — killed the gate job with an unhandled
  `ZodError` stack trace instead of a gate decision. Because a crashed gate job looks exactly
  like a blocked one, a broken pipeline was indistinguishable from a failing test suite.
  Aggregation now recognises a CTRF report by its top-level `results` object and ignores JSON
  that is not one (and directories named `*.json`, which previously raised `EISDIR`). A file
  that *is* CTRF-shaped but fails the schema still fails the command — skipping it would
  understate the test count — but now as a `WardenError` naming the file and the failing
  fields, never a raw `ZodError` dump.
- **Every documented command named a package that belongs to someone else.** The docs, the
  workflow `warden init` scaffolds, and the GitHub Action all invoked the CLI as
  `npx warden …`. On npm the unscoped name `warden` is an unrelated package published in 2014
  ("A wrapper for Panopticon") which declares no `bin`, so following the first step of Getting
  Started downloaded a stranger's tarball and then failed with "could not determine executable
  to run" — a third-party download in Warden's name, and an error that named nothing the reader
  could act on.
  - Every generated invocation now names the package it wants:
    `npx --yes --package=@warden/cli -- warden <command>`. `--yes` because a runner has no TTY
    for npx's prompt, `--` because npx otherwise claims `--base`/`--grep` as its own flags. The
    spelling lives in one place, `@warden/core`'s `cli-invocation.ts`, so the Action and the
    scaffolded workflow cannot drift apart.
  - The docs no longer claim `@warden/cli` is installable. It is not published; `npm install
    @warden/cli` and every `npx` form of it return 404. `docs/cli.md` now has an **Installing**
    section giving the route that does work today — build from source and run
    `packages/cli/dist/bin/warden.js` — and Getting Started starts there. What the invocation
    will be once the package ships is written down as exactly that.
  - The workflow `warden init` writes carries the same statement in a comment at the top, so a
    user who commits it learns why the step 404s from the file itself.
  - Guards: `documented-invocation.test.ts` fails if any fenced command in any Markdown file in
    the repository hands npx the bare name again, and the Action's and scaffolder's tests assert
    the argv names `@warden/cli`.

### Added

- **`warden report aggregate --head-sha <sha>`**, and the `warden init` scaffold now passes
  `github.event.pull_request.head.sha` to it. On a `pull_request` event `$GITHUB_SHA` is the
  merge commit, while a required status check is read off the PR's head commit — a check run on
  the merge commit is not the one branch protection waits for.
- **`TestResult.priority`, read from the runner.** `blockOnCritical` and `warnOnHighCount` decide
  on a result's priority, and no result ever carried one. Warden now reads it from a CTRF test's
  `extra.priority` or a `@P1`-style tag, and `executionToCtrf` writes it back out, so criticality
  survives the `warden run` → `warden report aggregate` round trip. Tests the runner did not mark
  have no priority and the priority rules pass over them — an unmarked test is never assumed
  critical.
- **A contract test between the Action and the CLI.** The Action's tests inject a fake `ExecFn`
  that accepts any argv, which is why an argv no CLI would accept passed every test in the
  package. `@warden/cli` now exports `createProgram()` — the real Commander tree — and
  `packages/github-action/src/warden-cli.contract.test.ts` parses the argv each wrapper builds
  with it. The flags the Action sends and the flags the CLI declares are now read from one place.
- **`scope.modulePaths`** — the trees a changed file has to be under to count as a module. It
  defaults to `['apps/', 'src/features/']`, which is what the derivation was previously hardcoded
  to, so existing configs behave identically. A repo laid out any other way (`crates/`, `cmd/`,
  `internal/`, `libs/`, `services/`) can now be scoped selectively at all. A trailing slash is
  optional.
- **`WARDEN_PLAYWRIGHT_BIN`** — an absolute path to a Playwright CLI outside the project's
  `node_modules`, for a global install or a container image that ships one. It takes precedence
  over the project's own copy; a path that does not exist is an error, never a silent fallback.
- **`warden init --force`** — replace existing files without asking, for the case where you do want
  the templates back.

### Changed

- `RunReportDeps.octokit` (`@warden/cli`) now requires the `checks` half of the octokit shape
  (`OctokitIssuesClient & OctokitChecksClient`) because the check run is part of what
  `report aggregate` posts. `createFetchOctokit` already returned both.
- **`warden init` marks the tier steps `continue-on-error: true`.** Now that a blocking tier exits
  non-zero, an unmarked tier job would skip the jobs leading to the gate, and the PR would go red
  with no verdict comment on it. The aggregate step is deliberately left unmarked: it is the merge
  verdict, and its exit code is what turns the check red.
- **The `warden` Commander program moved to `packages/cli/src/program.ts`** as `buildProgram()`;
  `bin/warden.ts` is now only version resolution plus `parseAsync`. Nothing about the CLI's
  interface changed — the wiring simply had to be reachable from a test, because the exit code is
  wiring and no command function returns it. That is the hole this defect fell through.
- **`gates.blockOnPassRateBelowPercent` now defaults to `100`, not `90`.** No shipped behaviour
  changes: 100% is the policy Warden has always enforced, because the code holding the `90` was
  never called. Now that the number is live, it had to be corrected to the one being applied —
  a default of `90` would have silently loosened every repo's gate to tolerate one failure in
  ten. `warden init` and the documented example scaffold `100` for the same reason.
- **A tolerated failure `WARN`s instead of vanishing.** Where a lowered pass-rate floor now lets a
  run through, the decision still names what failed (`1 test(s) failed, within the configured
  gate`). A loosened gate means "do not block on this", never "there was nothing to report".
- **The pass rate is computed over executed tests** (`PASS + FAIL + FLAKY`). Skipped and blocked
  tests produced no verdict and are excluded from both halves, so an unrelated `test.skip` cannot
  push a run under the floor; a `FLAKY` result passed after a retry, so it counts towards the rate
  and raises its own `WARN` rather than being scored as a failure.
- `ReportContext` gained an optional `gate?: GateDecision`. A custom `Reporter` should publish
  `ctx.gate` (via the new exported `resolveGateDecision(execution, ctx)`, which falls back to
  `computeGateDecision(execution)` when the caller supplied none) rather than calling
  `computeGateDecision` directly — that function sees test results only and cannot know about the
  other tiers. Existing reporters keep compiling and behave as before when no gate is supplied.
- **Inline `plugins: [...]` objects need the plugin registry or `WARDEN_TRUST_CONFIG=1`.** A
  plugin is an object with functions on it, which a config read as data cannot express. Use
  `pluginRegistry` (manifest-based discovery) instead; `defineConfig` called programmatically is
  unaffected.
- **A computed config value now fails loudly instead of working.** `pushgatewayUrl:
  process.env.…` and friends are refused with a `ConfigError` naming the line, rather than being
  silently evaluated. Move the value into the config as a literal, or opt in with
  `WARDEN_TRUST_CONFIG=1`.

### Security

- **`warden.config.*` is parsed as data and never executed.** `loadConfig` handed the file to
  c12/jiti, which transpiles and runs it. On CI that file is the *pull request's* copy and the
  reader is `warden agent`, holding `ANTHROPIC_API_KEY` — so a three-line `warden.config.ts` in a
  PR ran arbitrary code inside a job with the key, before any agent work started. The loader now
  reads the exported literal (objects, arrays, strings, numbers, `true`/`false`/`null`, comments,
  trailing commas, `as const`/`satisfies`, an optional `defineConfig(…)` wrapper) and refuses
  calls, variable references, template substitutions, spreads, computed keys and any statement
  outside the default export, naming file, line and column. `.ts`, `.mts`, `.cts`, `.js`, `.mjs`,
  `.cjs`, `.json` resolve in that order and `warden.config.local.*` deep-merges on top.
  `WARDEN_TRUST_CONFIG=1` restores the evaluate-with-c12 behaviour for a checkout you vouch for;
  `warden init` and the GitHub Action never set it.
- **A config file can no longer redirect model prompts off the machine.** `ai.ollama.baseUrl` was
  a bare `z.string()`, and `ai.fallbackProvider: 'ollama'` is the documented keyless fallback — so
  one line in a PR's config sent every prompt (diff summary, seeded fixture values, live page
  text) to an attacker's endpoint. It is now validated as an `http(s)` URL, and a config file read
  from the repository under test may only name a loopback host. Set `WARDEN_OLLAMA_BASE_URL` in
  the environment — which a pull request cannot write — to point Warden at a remote Ollama. The
  GitHub App's `warden.config.json` reader enforces the same rule.

## [0.4.1] — 2026-07-11 · "Fail Closed"

A correctness patch from a systemic audit of every gate-decision path: 16 places where an
empty/degenerate input ("nothing ran, passed, measured, or gated") produced a false-green `PASS`.
All now signal honestly — WARN-direction across the board, except the GitHub Action, which fails
**closed** to BLOCK so a broken gate can never post a green check that unblocks a merge.

### Fixed

- **Gate hardening — "nothing ran/passed" never reads as a green gate.** A parallel audit of the
  gate-decision logic surfaced a class of empty/degenerate inputs that returned a false `PASS`.
  All now WARN honestly (WARN-direction only, so no currently-passing merge is newly blocked):
  - `computeGateDecision` → `WARN "no tests passed"` when tests ran but every result was skipped
    or blocked (previously `PASS "All tests passed"` — a blocked test started but never finished).
  - `evaluateExitCriteria([])` → `WARN "no tests ran"` (the pass-rate math previously manufactured
    100% for an empty 0/0 set).
  - `combineGateDecisions([])` and the CUJ `mergeGateDecisions()` → `WARN`, not a vacuous `PASS`,
    when given no decisions to combine.
  - The CUJ gate `WARN`s a touched journey whose tests didn't run this change (`NOT_TESTED`)
    instead of reporting it "healthy" against a DEGRADED/BROKEN baseline.
- **The GitHub Action now fails _closed_.** A crashed/absent `warden report aggregate` step, or an
  aggregate report with a missing/unrecognized gate decision, previously defaulted the merge check
  to `PASS` — a broken gate could post a green check and unblock a merge. Both now resolve to
  `BLOCK`; only an explicit, recognized `PASS`/`WARN`/`BLOCK` is trusted.
- **Quality tiers that ran but measured nothing now `WARN` instead of `PASS`.** "0 failures" is not
  "no measurements": the perf/Lighthouse tier when routes were audited but no metric was readable,
  the k6 load tier when the run issued zero requests, the component tier when the runner collected
  0 tests, the Pact tier when no contracts were verified, the i18n gate when no locales were
  compared, and the CUJ gate when it's enabled but no CUJ definitions loaded.

## [0.4.0] — 2026-07-10 · "Dogfood"

Driven by dogfooding `warden run` against Warden's own repo (and an adversarial verification
pass on the results): a batch of real fixes the hermetic tests never exercised, plus a local
loop that lets you **see your own run in the Sentinel dashboard**.

### Fixed

- **A local `warden run` no longer crashes** outside GitHub Actions. When no GitHub client
  is available the PR-comment and check-run reporters are skipped with a warning instead of
  throwing, and the job summary falls back to `<artifacts-dir>/job-summary.md`. The CI path
  (where the Action supplies an octokit) is unchanged.
- **CTRF reports keep human-readable test names.** The CTRF→execution→CTRF round-trip was
  replacing each test's title with its opaque `testCaseId` hash (`TC-ef7a…`); reports now
  carry the real title (e.g. `checkout › apply discount code`) and `filePath`, so the
  dashboard, PR comment, and job summary are legible. `testCaseId` remains the stable
  identity for flake/quarantine history.
- **The PR comment / job-summary coverage table** now shows the human-readable test name
  instead of the `testCaseId` hash — the last surface that still leaked hashes.
- **The gate no longer reports a false green when zero tests ran.** `computeGateDecision`
  previously emitted `PASS — "All tests passed"` for an empty (or silently unparseable)
  report; it now returns `WARN — "no tests ran"`, surfacing the anomaly without hard-blocking
  legitimate no-test changes.

### Added

- `TestResult` gains optional `name` and `filePath` fields (additive; consumers fall back to
  `testCaseId` when absent).
- **`warden run --db <path>`** persists a run into a SQLite store, so flake history builds up
  across runs and the dashboard can render real results. Off by default — no store is written
  unless `--db` is given.
- **See a real run in the dashboard locally.** `snapshot.mjs` accepts `WARDEN_STORE=<path>` to
  build the dashboard snapshot from a real store (instead of the demo seed), and prefers each
  result's real name. Panels a single run can't populate (Coverage Sync, CUJ, Visual
  Regression, Flake Intelligence, Learning) now render honest empty states for a real snapshot.
- **`examples/dashboard-selftest/`** — a dogfood example that runs Warden's `@smoke` tier
  against its own dashboard over http, persists the run, and rebuilds the dashboard from it, so
  you can open the Sentinel UI locally and see your own results.

## [0.3.0] — 2026-07-09 · "Tier-3 & Hardening"

Completes the **Tier-3 roadmap** (all six items), packages the GitHub Action for real
distribution, brings every dependency to its latest major, and hardens the codebase against
its own security scanning. Everything new is additive, defaulted off, and hermetically tested.

### Added — Tier-3 (precision)

- **Test impact analysis** (`@warden/impact`) — a coverage index maps each test to the files it
  exercised; `warden run --impact-index <path>` narrows the run to exactly the tests a diff impacts,
  with a safety net for uncovered files. Risk escalation still forces the full suite.
- **Component / Storybook testing** — a `component` tier in `@warden/runner` (Playwright CT or the
  Storybook test-runner) → CTRF + gate.
- **Load testing** — a first-class `load` tier (k6 VUs/duration + p95/p99/error-rate thresholds).
- **i18n content checks** — a pure `i18n` check for missing/empty translation keys across locales.

### Added — Tier-3 (ecosystem)

- **Hosted results service** (`@warden/results-service`) — mints HMAC-signed, expiring **share tokens**
  granting read-only access to one run's (redacted) results via a public link; opt-in, self-hostable,
  secrets from env.
- **Plugin registry** (`@warden/plugin-registry`) — a manifest schema + a searchable registry
  (by text/capability/tag) + a dynamic resolver that turns a manifest into a `QAPlatformPlugin`.

### Added — integration & UX

- The **accessibility + performance-budget tiers are wired into `warden run`** (`--base-url` / `--base`
  / `--head`) and into the **GitHub Action** (new `base-url` input) alongside the **CUJ-scoped gate**.
- Dashboard panels for **Critical User Journeys**, **Visual Regression**, and **Flake Intelligence**.

### Changed — packaging & CI

- The **GitHub Action is now distributable**: its bundle is inlined and committed, guarded by a CI
  freshness check — `uses: QuintinBotes/warden/packages/github-action@v0.3.0` works.
- **Dependabot** version updates + **CodeQL** code scanning are enabled and running clean.
- **Dependency modernization** — brought to latest major: React 19, Next 16, Vitest 4, jsdom 29,
  `@types/node` 26, better-sqlite3 12, lighthouse 13, jose 6, commander 15, js-yaml 5, c12 3,
  pixelmatch 7, `@actions/core` 3, and the `@octokit/*` majors. (TypeScript is deliberately held at 5.6
  until tsup/rollup-plugin-dts support TS 7's native compiler.)

### Security

- **Resolved every CodeQL alert** (0 open): backtracking regexes replaced with linear
  `@warden/core` helpers (`stripTrailingSlashes`, `slugify`) or safe rewrites; the markdown
  `escapeCell` and route-wildcard substitution hardened against incomplete sanitization.
- Pinned the `undici` override to the 7.x line (still above the 6.27.0 GHSA floor) so jsdom 29 loads.

### Notes

- Package count 25 → **28**; the test suite ~1,180 → **1,315**. All new capabilities remain opt-in.

## [0.2.0] — 2026-07-09 · "Warden Next"

The competitive-gap roadmap, shipped. Thirteen new capabilities, all **additive to
`@warden/core`, defaulted off, independently shippable, and hermetically tested**. They
compose into one PR pipeline with Critical User Journeys as the organizing layer and a single
`BLOCK`/`WARN`/`PASS` gate + CTRF report as the shared contracts (see
[`docs/proposals/2026-07-08-warden-next-integrated-flow.md`](docs/proposals/2026-07-08-warden-next-integrated-flow.md)).

### Added — Tier 1 (credibility & scale)

- **Visual regression** (`@warden/visual`) — deterministic screenshot capture + `pixelmatch` diffing,
  Git-versioned baselines, and an optional AI structure-aware judge (via `LLMProvider.generateWithImages`)
  that suppresses render-noise. Emits CTRF + a `VISUAL_DIFF` status into the gate; `warden visual approve`.
- **Notifications** (`@warden/notifications`) — first-party Slack / Teams / PagerDuty / webhook plugins,
  plus the orchestrator `firePluginHooks` dispatcher (a bad webhook can never fail the run or block the gate).
- **Accessibility & performance budgets** — axe-core + Lighthouse tiers in `@warden/runner` (pure
  converters + gate evaluators, mirroring k6/ZAP), a changed-route resolver, and `combineGateDecisions`.
  Wired into `warden run` via `--base-url`/`--base`/`--head`.
- **Flaky-test intelligence** — configurable retry policy, an LLM root-cause classifier, quantified
  `FlakeImpact`, and trend queries across test-management / agent / observability / dashboard-api.
- **Test-data management** (`@warden/fixtures`) — a `DataProvider` seam with SQL / API / Testcontainers
  providers, namespaced seed/teardown, and a `FixtureOrchestrator` (seed in order, teardown in reverse,
  never throws).
- **API & contract testing** — an `api` tier (Schemathesis OpenAPI fuzzing + Pact broker verification)
  and a contract-drift-impact unit in `@warden/coverage-sync`.
- **Device cloud grid** (`@warden/grid`) — a `GridProvider` seam + shard planner + local / BrowserStack /
  Sauce Labs / LambdaTest adapters + lane-aware CTRF merge.

### Added — Tier 2 (differentiators & moat)

- **Test-management sync** — a `TestManagementSync` seam with adapters for testomat.io (full,
  source-code-first, ID-stable), Qase, TestRail, Xray, Zephyr, and Allure TestOps.
- **Multi-SCM** (`@warden/vcs`) — a `VcsProvider` seam with GitHub / GitLab / Bitbucket / Azure DevOps
  adapters and a bridge onto coverage-sync's `GitHubAccess`.
- **Critical User Journey (CUJ) modeling** (`@warden/cuj`) — a first-class `Cuj` entity, worst-of health
  rollup, a CUJ-scoped merge gate (can only tighten), an exploratory-agent mission brief, and a board API.
- **Proactive self-healing** (`@warden/proactive-healer`) — opt-in pre-failure locator repair that opens
  a draft healing PR before tests go red.
- **Production-traffic recording** (`@warden/traffic`) — opt-in ingest → fail-closed PII scrub → cluster →
  synthesize specs → propose draft PRs + candidate CUJs.
- **Enterprise readiness** (`@warden/enterprise`) — OIDC auth (fail-closed), RBAC, an append-only audit
  sink, and per-tenant isolation for the hosted surfaces. `enterprise.auth.mode` defaults to `none`, so
  the self-hosted OSS core stays fully auth-optional.

### Added — dashboard & docs

- Dashboard panels for **Critical User Journeys**, **Visual Regression**, and **Flake Intelligence**.
- The **Warden Next** proposal set: a cited competitive gap analysis, an integrated-flow umbrella, and one
  design spec per capability.

### Security

- Forced `@opentelemetry/core >= 2.8.0` (GHSA-8988-4f7v-96qf) via a pnpm override.

### Notes

- All new capabilities are opt-in and default off; existing configs and pipelines are unaffected.
- Package count grew from 14 to 25; the test suite from 469 to ~1,180.

## [0.1.0] — 2026-07-08

Initial release. The core platform: PR-diff change surface + risk-scored tier selection; the
exploratory / generative / healer AI agents behind a provider interface (Claude default); Playwright +
Claude-in-Chrome browser engines; CTRF reporting across four GitHub surfaces with video/screenshot/trace
replay; SQLite test-management (Requirement→Test→Execution→Result) with a coverage matrix and flake
quarantine; a merge-gate verdict; the Sentinel dashboard; Prometheus/Grafana observability; Linear /
Jira / GitHub Projects requirement sync; a session recorder and learning studio; and the cross-repo
coverage-sync GitHub App.

[0.4.1]: https://github.com/QuintinBotes/warden/releases/tag/v0.4.1
[0.4.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.4.0
[0.3.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.3.0
[0.2.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.2.0
[0.1.0]: https://github.com/QuintinBotes/warden/releases/tag/v0.1.0
