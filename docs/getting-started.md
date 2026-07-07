# Getting Started

The goal: a developer with no QA background opens a pull request and sees their first AI QA report within ten minutes.

## Prerequisites

- A GitHub repository with a web app or API that can start in CI.
- An [Anthropic API key](https://console.anthropic.com/) (Claude is the default engine).
- Node.js 20+ if you want to run the CLI locally.

## 1. Add the workflow

Create `.github/workflows/ai-qa.yml` in your repo. The fastest way is to scaffold it:

```bash
npx warden init
```

`warden init` writes two files into your repo:

- `warden.config.ts` — your configuration (safe, sensible defaults).
- `.github/workflows/ai-qa.yml` — the tiered QA workflow.

Prefer to copy it by hand? See the full reference workflow in the [GitHub Action guide](github-action.md).

## 2. Add your API key

In your repository: **Settings → Secrets and variables → Actions → New repository secret**.

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | your Anthropic key |

Warden reads this from the workflow; it is never written to disk or logs.

## 3. Open a pull request

That's it. On the next PR, Warden will:

1. **Analyze** the diff — compute the change surface, derive test tags, and score risk.
2. **Run** the right tiers — smoke always; selective regression scoped to the changed modules; the AI exploratory agent when risk crosses your threshold.
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

Changes touching `auth`, `payment`, `checkout`, or shared infrastructure score higher automatically. Tune the rules in [Configuration](configuration.md).

## Run it locally

You don't need CI to try Warden. Point the CLI at a running preview:

```bash
# analyze what a branch changed
npx warden analyze --base origin/main --head HEAD

# run the exploratory agent against a local app
npx warden agent --strategy exploratory --url http://localhost:3000 --output report.json
```

If `ANTHROPIC_API_KEY` is unset, the agent runs with a stub provider so you can exercise the wiring without spending tokens. See the [CLI Reference](cli.md).

## Next steps

- Tune scope and gates in [Configuration](configuration.md).
- Understand the tiers and surfaces in [Architecture](architecture.md) and [Reporting](reporting.md).
- Self-host the dashboard and metrics stack in [Deployment](deployment.md).
