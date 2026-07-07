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

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `provider` | `anthropic` | AI provider to use. |
| `model` | (config) | Override the model id. |
| `strategy` | `exploratory` | Agent strategy to run. |
| `risk-threshold` | `4` | Risk score at which the exploratory agent runs. |
| `anthropic-api-key` | — | **Required.** Your Anthropic key (pass as a secret). |

## Outputs

| Output | Description |
|--------|-------------|
| `gate` | `PASS`, `WARN`, or `BLOCK`. |
| `risk-score` | The computed risk score (0–10). |
| `report-path` | Path to the aggregated CTRF report. |

Use them in later steps:

```yaml
      - uses: QuintinBotes/warden@v1
        id: qa
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
      - if: steps.qa.outputs.gate == 'BLOCK'
        run: exit 1
```

## The full tiered workflow

For fine-grained control, run each tier as its own job. A reference workflow ships with the Action as `ai-qa.example.yml`, implementing:

- **Tier 1 — Smoke**: `@smoke` tests on every push. The green gate for everything else.
- **Tier 2 — Selective regression**: only the tags the diff touched.
- **Tier 3 — AI exploratory**: the Claude agent, gated on risk.
- **Tier 4 — API contract tests**: when API routes changed.
- **Tier 5 — Test generation**: commit AI-generated tests back for high-risk PRs.
- **QA gate**: aggregate everything and post the decision.

`warden init` writes a starter version of this workflow into your repo.

## Required permissions

The workflow needs:

```yaml
permissions:
  contents: read         # read the diff (add write only if committing generated tests)
  pull-requests: write   # post the PR review comment
  checks: write          # publish the check run + inline annotations
```

## Reporting surfaces

Every run produces four surfaces at once — see [Reporting](reporting.md):

1. GitHub Job Summary
2. PR review comment (the AI report)
3. Check-run annotations (inline on changed files)
4. A CTRF JSON artifact
