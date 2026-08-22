# Reporting

Warden surfaces every run in four places at once, all derived from one canonical format.

## CTRF — one format for everything

Warden emits [CTRF](https://ctrf.io) (Common Test Report Format), a universal JSON schema for test results. Whether tests ran under Playwright, an API check, or a k6 or OWASP ZAP job, the output is one shape — queryable, mergeable, and portable.

```json
{
  "results": {
    "tool": { "name": "Playwright", "version": "1.52.0" },
    "summary": { "tests": 47, "passed": 44, "failed": 2, "skipped": 1, "start": 0, "stop": 0 },
    "tests": [
      {
        "name": "checkout > complete with credit card",
        "status": "failed",
        "duration": 8423,
        "message": "Expected 'Payment confirmed' but got 'Error processing payment'",
        "trace": "artifacts/checkout-failure.zip",
        "filePath": "tests/e2e/checkout.spec.ts",
        "tags": ["@apps/checkout", "@regression"],
        "extra": {
          "requirementIds": ["ISSUE-201"],
          "video": "artifacts/checkout-failure.webm",
          "screenshot": "artifacts/checkout-failure.png"
        }
      }
    ]
  }
}
```

Captured media — **video, screenshot, and trace** — is lifted into each test's `extra`, which is what powers E2E replay in the dashboard.

### Which files aggregation reads

`warden report aggregate --reports <dir>` is pointed at the artifacts directory, and that
directory holds JSON that was never a test report — the agent report from
`warden agent --output warden-artifacts/exploratory-report.json`, and `fixture-catalog.json`
from `warden run`. Aggregation identifies a CTRF report by its envelope, the top-level `results`
object, and skips every other JSON file. Sub-directories are not descended into.

A file that carries a `results` object but does not match the schema is a different case and
stops the command with an error naming the file and the failing fields. That one is not skipped
on purpose: ignoring a broken report would quietly shrink the run it was meant to describe, and
a gate is only as honest as the number of tests it counted.

## The four surfaces

All four publish the **same** decision — the one `warden run` returns and the one it hands to
`onGateDecision`. Reporters run last in a run, after every gate tier has been folded in, and each
is handed that final decision on its `ReportContext`; none derives a verdict of its own from the
test results. A green test run that an accessibility violation, a performance budget or a degraded
journey blocked therefore reads `⛔ BLOCK` on the PR comment and the check run, with the tier's own
reason, rather than `✅ PASS`.

### 1. GitHub Job Summary

A rich Markdown table written to `$GITHUB_STEP_SUMMARY` — pass/fail counts, slowest tests, flaky tests — visible in the Actions run without leaving GitHub.

### 2. PR review comment

The AI report, posted as a comment on the PR: risk score, bugs found (with steps, expected vs. actual, screenshots, severity), a coverage summary, requirements traceability, and the gate decision.

```
## 🤖 AI QA Report — PR #123
Risk Score: 7/10 (HIGH — payment flow changed)

🐛 Bugs Found (2)
🚦 QA Gate Decision: ❌ BLOCK MERGE
```

"No bugs found by the AI exploratory agent ✅" is only ever printed for an agent run that completed. If the tier was skipped (risk below the threshold) or failed, the section reads `🐛 Bugs Found (not measured)` and says which of the two happened and why — the comment never credits an agent that did not report.

When the diff could not be read — most often a shallow checkout, where the PR's base commit is
absent from the clone — the header reads `Risk Score: unknown` rather than a number, and a banner
above the report names the error and what Warden ran instead. A risk that was never measured is
never printed as `0/10 (LOW)`. See [`fetch-depth: 0` is required](github-action.md#fetch-depth-0-is-required).

### 3. Check-run annotations

For failures that map to a file and line, Warden posts inline annotations in the PR's **Files changed** tab via the Checks API — the failure shows up exactly where the code is.

The check run carries the gate decision as its conclusion (`failure` on `BLOCK`, `neutral` on `WARN`, `success` on `PASS`), which is what makes it usable as a required status check. It is created by `warden report aggregate` alongside the comment, and needs a head SHA to attach to: `--head-sha`, else `$GITHUB_SHA` / `$CI_COMMIT_SHA`. On a `pull_request` event pass `--head-sha "${{ github.event.pull_request.head.sha }}"` — `$GITHUB_SHA` is the merge commit, and a required status check is read off the PR's head commit. Set [`reporting.checkRunAnnotations: false`](configuration.md#reporting--where-results-go) to skip it.

### 4. CTRF artifact

The machine-readable report, uploaded as a build artifact and consumable by your own dashboards, BI, or the Warden dashboard.

## The merge gate

Warden evaluates your configured exit criteria and returns one decision:

| Decision | When |
|----------|------|
| `BLOCK` | Any test failed; **any test that started and never finished**; or the pass rate is below `gates.blockOnPassRateBelowPercent`. A `P1` failure and more `P2` failures than `warnOnHighCount` are reported on their own rules, ahead of the plain failure one. |
| `WARN` | Nothing failed and the pass rate holds, but the run is not clean: a flaky test, a newly quarantined test, no tests ran at all, or nothing passed. |
| `PASS` | Every result was a pass, and the pass rate clears your threshold. |

**Pass rate** is the share of results that ended green — `PASS`, plus `FLAKY` for a test that
passed on a retry — over every result in the run. A `SKIP` and a `BLOCKED` count against it:
neither produced an answer, and a run whose tests were nearly all skipped (a `--grep` that matched
almost nothing, a suite that bailed early, a fixture that skipped the rest) measured too little to
clear the bar you set, however few of the tests that did run came back red. Set
`gates.blockOnPassRateBelowPercent: 0` to switch the rule off.

The floor is not a failure allowance. A failing test blocks whatever it is set to, so lowering it
tolerates skipped tests and never red ones — `blockOnCritical: false` does not let a failing test
through either. Those priority-graded keys decide which reason is reported, not whether a red run
is caught.

Thresholds are configurable under [`gates`](configuration.md#gates--the-merge-gate), and the same
policy decides the gate on every surface — the PR comment, the check run, the job summary, `warden
run`'s exit code, and `warden report aggregate`.

Two things enforce the decision, and neither is the PR comment. `warden report aggregate` **exits `1` on `BLOCK`**, failing the CI step it runs in even if every API call it made failed; and it creates the `Warden QA` check run described above, which you can mark as a required status check so the merge button itself stays disabled.

`warden run` also carries its own tier's decision out as the process exit status — `1` on `BLOCK`, `0` on `PASS` and `WARN` — so a plain `warden run` step in a workflow fails when the tier does. See [Exit codes](cli.md#exit-codes).

In the GitHub Action the gate also fails **closed**: if the aggregate step crashes, or a test tier
did not complete (see [When a tier does not complete](github-action.md#when-a-tier-does-not-complete)),
the decision is `BLOCK` no matter what the tiers that did run reported — the evidence behind a
`PASS` would be missing.

A `WARN` is never silence. When a failure falls inside the thresholds you set, the reason still
names it (`2 test(s) failed, within the configured gate`) — Warden reports what happened and lets
your policy decide whether it blocks.

### Runs that were cut short

A test that started and never produced a result is `BLOCKED`, not `SKIP`. Playwright reports
these as `interrupted`, and it marks *every* unfinished test that way when a run is cut short —
`--max-failures` tripped, the suite's global timeout hit, or the runner took SIGINT/SIGTERM
because the CI job was cancelled or timed out.

Such a run has only a partial answer, so Warden refuses to read it as a whole one: the gate
`BLOCK`s with `N test(s) did not finish`, the CTRF report counts those tests under `pending`
(never `skipped`), and the PR comment, job summary and check output all show their status as
`BLOCKED`. A skip is a choice the author made; an unfinished test is a result nobody has.

### One decision, folded worst-of

Test results are only the first tier. `warden run` starts from them and then folds in, in order and
always worst-of — a tier can tighten the gate, never loosen it:

1. **Test results** — the exit criteria above.
2. **Flake quarantine** — a run that newly quarantines more tests than
   `flake.gate.warnOnNewlyQuarantinedAbove` raises a `WARN` (never a `BLOCK` on its own).
3. **Accessibility and performance budgets** — when the change touches a mapped route.
4. **The CUJ gate** — when the change touches a modelled critical user journey.

The result is what `runRun` returns, what the plugins' `onGateDecision` receives, what every
reporter publishes, and what the CLI's exit code reflects. There is one decision per run and one
place it is computed; a surface that disagreed with the exit code would be the bug.

## Flaky test quarantine

Tests that fail non-deterministically (a flake rate between 20% and 80%) are auto-quarantined after a configurable number of runs. Quarantined tests still run but **don't block the gate** — so flakiness never erodes trust in CI, and you keep the signal.

## Trends

With the [self-hosted stack](deployment.md#mode-2--self-hosted-stack), each run also pushes metrics to Prometheus, feeding Grafana dashboards for pass rate, flake rate, MTTR, escaped-defect rate, suite duration, and coverage delta per PR.
