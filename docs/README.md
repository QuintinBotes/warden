# Warden Documentation

Warden is an open-source, AI-native QA platform. It reads a pull request's diff, selects the tests that matter, sends an AI agent to break the build, and posts a merge-gate verdict back to GitHub — with Claude as the default engine, behind a provider interface so any model can be swapped in.

## Start here

| Guide | What it covers |
|-------|----------------|
| [Getting Started](getting-started.md) | Install the Action, add a config, open your first PR — in ~10 minutes |
| [Architecture](architecture.md) | How the pieces fit: orchestrator, agents, runner, store, reporters |
| [Configuration](configuration.md) | Every `warden.config.ts` option, with defaults |
| [CLI Reference](cli.md) | `warden analyze / run / agent / report / plan / init` |
| [GitHub Action](github-action.md) | Action inputs, outputs, and the tiered CI workflow |
| [AI Providers & Browser Engines](providers-and-engines.md) | Claude, the provider seam, Playwright vs. Claude-Chrome |
| [Reporting](reporting.md) | CTRF, the four GitHub surfaces, and E2E replay media |
| [Deployment & Self-Hosting](deployment.md) | Running Warden in CI and self-hosting the full stack |
| [Design System](design-system.md) | "Sentinel" — the visual language of the dashboard |

## Reference

- [Build specs](superpowers/specs/) — the V1 and V2 engineering specs that drive development
- [Contributing](../CONTRIBUTING.md) — how the monorepo is organized and how to work in it

## The mental model

Warden encodes a real QA mental model, not just "run the tests":

```
Requirement  →  Test  →  Test Execution  →  Result
     │            │             │              │
  what must    a check      one run of    PASS / FAIL /
   be true                  a test plan    FLAKY / BLOCKED
```

That traceability chain is what lets Warden answer **"is this feature safe to ship?"** — not merely "did the tests pass?"

## Support

- Issues and questions: [github.com/QuintinBotes/warden/issues](https://github.com/QuintinBotes/warden/issues)
- License: [MIT](../README.md)
