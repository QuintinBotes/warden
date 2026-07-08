# Architecture

Warden is a pnpm + Turborepo monorepo of small, single-purpose packages that communicate through the interfaces defined in `@warden/core`. Everything downstream depends only on those contracts, never on each other's internals.

## Component map

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub App / Actions Integration (warden-action)            │
│  PR webhook · CI trigger · Check-Run API · PR comments       │
└───────────────┬─────────────────────────────────────────────┘
                │
        ┌───────▼────────────────────────────┐
        │  Orchestration (@warden/orchestrator)│
        │  diff analysis · scope selection     │
        │  risk scoring · gate evaluation      │
        └───────┬───────────────┬──────────────┘
                │               │
   ┌────────────▼───┐   ┌───────▼──────────┐
   │ AI agents      │   │ Test runner      │
   │ (@warden/agent)│   │ (@warden/runner) │
   │ provider seam  │   │ Playwright +     │
   │ + 3 strategies │   │ Claude-Chrome    │
   └────────────────┘   └──────────────────┘
                │               │
        ┌───────▼───────────────▼──────────┐
        │ Test management (@warden/test-…) │
        │ SQLite history · YAML cases      │
        │ coverage matrix · flake quarantine│
        └───────┬──────────────────────────┘
                │
        ┌───────▼──────────────────────────┐
        │ Reporting (@warden/reporter)     │
        │ CTRF · Job Summary · PR comment  │
        │ Check-Run annotations            │
        └──────────────────────────────────┘
```

## Packages

| Package | Responsibility |
|---------|----------------|
| `@warden/core` | Shared types, Zod schemas, and every platform interface (`LLMProvider`, `BrowserEngine`, `Reporter`, `AgentStrategy`, `QAPlatformPlugin`) + `defineConfig`/`loadConfig`. The frozen contract surface. |
| `@warden/orchestrator` | Turns a diff into a plan: change surface, risk score, tier selection, and the merge-gate decision. Pure, deterministic functions. |
| `@warden/agent` | The LLM provider abstraction (Claude by default) and the three agent strategies. |
| `@warden/runner` | Browser engines (Playwright, Claude-Chrome) and the Playwright→CTRF converter, including captured media. |
| `@warden/test-management` | Persistent SQLite execution history, Git-YAML test cases, the coverage matrix, and flake quarantine. |
| `@warden/reporter` | The four reporting surfaces and PR-report rendering. |
| `@warden/cli` | The `warden` binary that composes all of the above. |
| `warden-action` | The published GitHub Action. |

## The three agent strategies

Warden ships three AI agents, each behind the same `AgentStrategy` interface:

- **Exploratory** — given a diff and a running preview, it browses the app like an expert QA engineer looking for what breaks: edge cases, boundary values, mobile viewports. Produces structured findings with severity.
- **Generative** — reads the diff and writes deterministic Playwright `.spec.ts` files, so tests are versioned alongside the code.
- **Healer** — when a test fails, it analyzes the trace and decides: real regression, or test-maintenance issue? Then proposes the minimal fix.

## Selective testing

The orchestrator's most important job is computing the **change surface** from the diff:

- Files → changed modules (by convention, `apps/<module>/` and `src/features/<module>/`).
- Modules → Playwright test tags (`@apps/checkout`).
- Shared/infrastructure changes (`lib/`, `shared/`, `packages/core/`, `*.config.ts`) escalate to the full suite.
- High-risk patterns (`auth`, `payment`, `checkout`, …) raise the risk score, which selects the test tier.

This is what keeps CI fast on small changes and thorough on dangerous ones.

## Data model

Warden models QA the way Xray does, so results are traceable:

- **Requirement** → **Test** → **Test Execution** → **Result**
- A **Coverage Matrix** answers, per requirement: which tests cover it, and is it currently `PASSED` / `FAILED` / `PARTIAL` / `NOT_TESTED`.

See [`@warden/core` schemas](../packages/core/src/schema.ts) for the exact shapes.

## Extensibility

Every seam is swappable:

- **AI provider** — implement `LLMProvider` (Anthropic/Claude by default, with OpenAI, Gemini, and Ollama available).
- **Browser engine** — implement `BrowserEngine` (Playwright, Claude-Chrome, and Stagehand available).
- **Reporter** — implement `Reporter` for a new surface.
- **Plugins** — Vite-style lifecycle hooks (`onPROpened`, `onTestExecutionComplete`, `onBugFound`, `onGateDecision`) plus provider/engine/reporter overrides.

Swapping any of these is a config-level change, not a fork.
