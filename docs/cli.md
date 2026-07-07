# CLI Reference

The `warden` binary composes the whole platform for local runs and CI steps. Install it as a dev dependency or invoke it with `npx warden`.

```bash
npm install --save-dev @warden/cli
# or
npx warden <command>
```

All commands read `warden.config.ts` from the current directory (see [Configuration](configuration.md)).

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
```

`run_full_suite` is `true` when the diff touches shared/infrastructure paths.

## `warden run`

Run tests (scoped by tag), write a CTRF report, and invoke the configured reporters.

```bash
warden run --grep "@apps/checkout" --artifacts-dir ./artifacts
```

| Flag | Description |
|------|-------------|
| `--grep <tags>` | Playwright tag expression to scope the run. |
| `--artifacts-dir <dir>` | Where CTRF, screenshots, and videos are written. |

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

> If `ANTHROPIC_API_KEY` is not set, `warden agent` runs with a stub provider so you can exercise the flow without spending tokens. Set the key for real results.

## `warden report`

Aggregate CTRF reports and post the QA gate decision.

```bash
warden report aggregate --reports ./reports --pr 123
```

| Flag | Description |
|------|-------------|
| `aggregate` | Merge all CTRF files in `--reports` into one. |
| `--reports <dir>` | Directory of CTRF JSON files. |
| `--pr <n>` | PR to comment on (needs `GITHUB_TOKEN`). |

## `warden plan`

Emit a canonical Test Plan (Markdown) with objective, scope, entry/exit criteria, and risk sections.

```bash
warden plan --name "Checkout v2" > TEST-PLAN.md
```

## `warden init`

Scaffold configuration into the current repository.

```bash
warden init
```

Writes `warden.config.ts` and `.github/workflows/ai-qa.yml`. Safe to run in an existing repo; it won't overwrite files you've customized without confirmation.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success, or gate decision `PASS`/`WARN`. |
| `1` | Gate decision `BLOCK`, or a command error. |

Use the exit code to fail a CI step when the gate blocks.
