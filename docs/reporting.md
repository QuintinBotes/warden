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

## The four surfaces

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

### 3. Check-run annotations

For failures that map to a file and line, Warden posts inline annotations in the PR's **Files changed** tab via the Checks API — the failure shows up exactly where the code is.

### 4. CTRF artifact

The machine-readable report, uploaded as a build artifact and consumable by your own dashboards, BI, or the Warden dashboard.

## The merge gate

Warden evaluates exit criteria and returns one decision:

| Decision | When |
|----------|------|
| `BLOCK` | Any P1 (critical) failure; too many P2 failures; or pass rate below your threshold. |
| `WARN` | At least one P2 (high) failure, but within limits — review advised. |
| `PASS` | All exit criteria met. |

Thresholds are configurable under [`gates`](configuration.md#gates--the-merge-gate). Wire the decision to a required status check to enforce it.

## Flaky test quarantine

Tests that fail non-deterministically (a flake rate between 20% and 80%) are auto-quarantined after a configurable number of runs. Quarantined tests still run but **don't block the gate** — so flakiness never erodes trust in CI, and you keep the signal.

## Trends

With the [self-hosted stack](deployment.md#mode-2--self-hosted-stack), each run also pushes metrics to Prometheus, feeding Grafana dashboards for pass rate, flake rate, MTTR, escaped-defect rate, suite duration, and coverage delta per PR.
