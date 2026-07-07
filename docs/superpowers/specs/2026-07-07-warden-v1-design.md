# Warden V1 — Parallel-Agent Build Spec

> **Warden** is an open-source, AI-native QA platform: it reads a PR diff, selects the right
> tests, runs them, drives an AI agent to break the app, and posts a merge-gate verdict back to
> GitHub. Claude is the default engine, abstracted behind a provider interface. Everything is
> self-hostable and MIT-licensed.
>
> **This document is a _swarm build spec_.** It is written so that a swarm of implementation
> agents can build V1 in parallel with near-zero coordination. The rule that makes that possible:
> **one wave defines the contracts, later waves implement against the contracts — never against
> each other.** The machine-readable companion is [`2026-07-07-warden-v1-swarm.manifest.yaml`](./2026-07-07-warden-v1-swarm.manifest.yaml).

- **Status:** approved design, ready to plan/build
- **Date:** 2026-07-07
- **Source of truth for _what_:** [`../../../Building an Open-Source AI QA Platform ...md`](../../../) (the blueprint)
- **Source of truth for _how it's carved for parallelism_:** this file + the manifest
- **Companion specs:** [`2026-07-07-warden-v2-design.md`](./2026-07-07-warden-v2-design.md) · Design system: the "Sentinel" artifact

---

## Part A — Goals & Non-Goals

### A.1 V1 goals
1. A developer adds one GitHub Action + one config file + one secret, opens a PR, and sees an AI QA report within ~10 minutes of setup.
2. The platform models QA correctly: Requirement → Test → Execution → Result, with smoke/sanity/regression/exploratory distinctions first-class.
3. Selective testing: the change surface of a PR decides which tests run and which AI tier fires.
4. Three AI agent strategies ship: **exploratory** (break it), **generative** (write tests from the diff), **healer** (diagnose failures).
5. Two browser engines ship: **Playwright** (headless, CI default) and **Claude-Chrome** (real Chrome via the Claude browser extension, local-first).
6. Results surface in four places: CTRF JSON, GitHub Job Summary, PR review comment, and Check-Run annotations.
7. Everything is swappable via `warden.config.ts` and a Vite-style plugin API — provider, browser engine, reporter, and lifecycle hooks.

### A.2 Non-goals for V1 (deferred to [V2](./2026-07-07-warden-v2-design.md))
OpenAI/Gemini/Ollama providers · Stagehand engine · Grafana/Prometheus dashboards · the Next.js traceability **dashboard UI** · session recording · k6 perf · OWASP ZAP · Linear/Jira sync · multi-browser matrix · mobile/Appium. The V1 **interfaces** must leave clean seams for all of these (they are why the abstractions exist), but no V1 work-stream implements them.

### A.3 Success criteria (V1 is "done" when)
- Warden's own repo runs Warden on its own PRs (dogfood, WS-30).
- The three example apps each get a real AI QA report on a demo PR.
- `pnpm -w test` is green; `pnpm -w build` produces publishable packages; the Action is installable from a local `action.yml`.
- See **Part F** for the full exit checklist.

---

## Part B — Swarm Execution Protocol

**Read this before dispatching any agent.** It is the operating manual for running this spec as a swarm.

### B.1 Waves (the only synchronization points)

| Wave | Work-streams | Parallelism | Barrier before next wave |
|------|--------------|-------------|--------------------------|
| **0** | `WS-00 core` | 1 agent (solo) | `@warden/core` builds, exports are frozen, `pnpm --filter @warden/core test` green |
| **1** | `WS-10 orchestrator`, `WS-11 agent`, `WS-12 runner`, `WS-13 test-management`, `WS-14 reporter` | 5 agents parallel | each package builds + unit tests green against core |
| **2** | `WS-20 cli`, `WS-21 github-action` | 2 agents parallel | CLI commands run end-to-end on the example apps; Action composes locally |
| **3** | `WS-30 examples + self-CI` | 1–3 agents | dogfood PR produces a real report |

There are **exactly three barriers** (end of wave 0, 1, 2). Within a wave, agents never wait on each other because they only depend on the previous wave's frozen output.

### B.2 The rule that prevents conflicts: **disjoint ownership**
Every work-stream `ownsPaths` a set of directories. **An agent may only create/edit files under its own `ownsPaths`.** No two work-streams share a writable path. Shared truth lives exclusively in `@warden/core` (wave 0) and is *read-only* to everyone in waves 1–3. If a wave-1 agent believes it needs to change a core type, it does **not** edit core — it records the request in `docs/superpowers/specs/contract-change-requests.md` and stubs locally; the change is reconciled by the human/lead between waves. This keeps `core` a stable contract.

### B.3 Contract-first, not implementation-first
Wave 0 ships **types + interfaces + Zod schemas + no-op/stub factories** for every seam. That means a wave-1 agent building the `orchestrator` can import `Reporter` from core and call it, even though `WS-14 reporter` (the real implementation) is being built simultaneously by a different agent. Agents test against **fakes** they own, not against sibling packages. Integration across packages is proven in wave 2 (CLI) and wave 3 (examples).

### B.4 Isolation mechanics
- Preferred: each wave-1/2 agent runs in its **own git worktree** (`isolation: worktree`) so parallel file writes never collide; worktrees merge cleanly because ownership is disjoint.
- Alternative (no worktrees): a single working tree is fine *because* ownership is disjoint — agents touch non-overlapping directories. Root-level files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`) are **owned by WS-00 only**; later waves add their package's own `package.json` under their `ownsPaths`.

### B.5 Definition of Done per work-stream (uniform)
An agent's work-stream is done when **all** hold:
1. Every file it created lives under its `ownsPaths`.
2. `pnpm --filter <pkg> build` succeeds (TypeScript, no `any` escapes on public API).
3. `pnpm --filter <pkg> test` is green, and the tests cover every bullet in that work-stream's **Acceptance criteria**.
4. Its public API exactly matches the **Contract** section here (names, signatures, return types).
5. `pnpm --filter <pkg> lint` and `typecheck` pass.
6. No import of a sibling wave-1 package's internals (only `@warden/core` and its own deps).

### B.6 Verification gate (run by the lead at each barrier)
`pnpm -w build && pnpm -w test && pnpm -w typecheck`. If red, the failing work-stream is re-dispatched with the failure log; the wave does not advance until green.

### B.7 How a dispatcher consumes the manifest
`swarm.manifest.yaml` lists every work-stream with `wave`, `dependsOn`, `ownsPaths`, `contract` (pointer into this doc), `acceptanceCriteria`, and `testCmd`. A runner: (1) topologically groups by `wave`; (2) for each wave, dispatches one agent per work-stream in parallel, each prompted with "implement `<id>` per `spec.md#<contract-anchor>`; you own only `<ownsPaths>`; you are done when `<testCmd>` passes and acceptance criteria are met (TDD: write those tests first)"; (3) runs the wave barrier; (4) advances.

---

## Part C — Tech Stack & Cross-Cutting Conventions

Locked for V1 so agents don't re-decide:

| Concern | Choice | Rationale |
|--------|--------|-----------|
| Monorepo | **pnpm workspaces + Turborepo** | blueprint's `packages/*`; fast, cache-aware |
| Language | **TypeScript 5.6+, ESM, Node 20+** | one language across the platform |
| Validation | **Zod** | schemas double as runtime guards + TS types via `z.infer` |
| Unit tests | **Vitest** | fast, ESM-native; every package uses it |
| E2E runner | **Playwright 1.52+** | the default browser engine + example tests |
| Local browser | **Claude-in-Chrome MCP** | the "claude-chrome" engine (real Chrome, user session) |
| DB | **better-sqlite3** | synchronous, zero external service, embeddable in CLI |
| Config load | **c12** | loads `warden.config.ts` (TS) with defaults + env merge |
| CLI framework | **commander** | ubiquitous, small |
| GitHub API | **@octokit/rest** + **@actions/core** | checks, comments, annotations, job summary |
| AI SDK (v1) | **@anthropic-ai/sdk** | Claude default |
| Report schema | **CTRF** (Common Test Report Format) | universal JSON; `github-actions-ctrf` for summaries |
| Lint/format | **ESLint (typescript-eslint) + Prettier** | shared root config, owned by WS-00 |

**Conventions every agent follows:**
- Public API is exported from each package's `src/index.ts` (barrel). Internal files are not imported across packages.
- Errors: throw typed `WardenError` subclasses (defined in core); never throw bare strings.
- All I/O boundaries validate with the core Zod schemas before use.
- Test tags: Playwright test titles/annotations use `@<module>` (e.g. `@apps/checkout`) and `@smoke`/`@regression`/`@exploratory`.
- No secrets in code; read from env (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`).
- File naming: `kebab-case.ts`; types/interfaces `PascalCase`; the barrel is `index.ts`.

---

## Part D — The Contract Surface (`@warden/core`, WS-00)

**This is the most important section.** Everything in waves 1–3 imports from here. WS-00 delivers all of it; once wave 0's barrier passes, these signatures are frozen for V1.

### D.1 Domain schema (Zod + inferred types)
`packages/core/src/schema.ts` — Requirement, TestCase, TestPlan, TestExecution, TestResult exactly as the blueprint's Part V, expressed as Zod schemas with inferred types. Key shapes:

```ts
export const TestStatus = z.enum(['PASS','FAIL','SKIP','BLOCKED','FLAKY']);
export const Priority = z.enum(['P1','P2','P3']);
export const TestType = z.enum(['unit','integration','smoke','sanity','regression','exploratory','api','performance','security']);

export const TestCaseSchema = z.object({
  id: z.string(),                       // "TC-001"
  title: z.string(),
  type: TestType,
  priority: Priority,
  tags: z.array(z.string()),            // ["@apps/checkout","@smoke"]
  requirementIds: z.array(z.string()),
  automation: z.object({
    framework: z.enum(['playwright','vitest','jest','k6','manual']),
    filePath: z.string().optional(),
    testName: z.string().optional(),
  }),
  source: z.enum(['manual','ai-generated','recorded']),
  generatedFrom: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;
// ...Requirement, TestPlan, TestExecution, TestResult, CoverageStatus likewise.
```

### D.2 CTRF report schema
`packages/core/src/ctrf.ts` — the CTRF JSON shape (blueprint Part VI) as Zod, plus `mergeCtrf(reports: CTRFReport[]): CTRFReport` signature (impl in WS-14, type here).

### D.3 Change-surface & risk types
`packages/core/src/change-surface.ts`:
```ts
export interface ChangeSurface {
  changedFiles: string[];
  changedModules: string[];
  testTags: string[];
  hasSharedChanges: boolean;
  affectedApiRoutes: string[];
  affectedComponents: string[];
  riskScore: number;            // 1–10
  riskReasons: { pattern: string; reason: string; score: number }[];
}
export type TestTier = 'smoke' | 'selective' | 'fullRegression' | 'aiExploratory';
export interface GateDecision { decision: 'PASS'|'WARN'|'BLOCK'; reason: string; }
```

### D.4 LLM provider interface
`packages/core/src/llm.ts` — the seam that lets v2 swap providers:
```ts
export interface LLMProvider {
  name: string;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  generateWithTools(prompt: string, tools: Tool[], options?: GenerateOptions): Promise<ToolCallResult>;
  streamText?(prompt: string): AsyncIterable<string>;
}
export interface GenerateOptions { model?: string; maxTokens?: number; temperature?: number; systemPrompt?: string; }
export interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; }
export interface ToolCallResult { text?: string; toolCalls: { name: string; input: unknown }[]; raw: unknown; }
export type ProviderFactory = (cfg: WardenConfig['ai']) => LLMProvider;
```

### D.5 Browser engine interface (Playwright **and** Claude-Chrome live behind this)
`packages/core/src/browser.ts` — the seam the user asked to extend with the Claude extension:
```ts
export interface BrowserEngine {
  name: 'playwright' | 'claude-chrome';
  launch(opts: BrowserLaunchOptions): Promise<BrowserSession>;
}
export interface BrowserSession {
  goto(url: string): Promise<void>;
  /** deterministic, role-based interactions (Playwright-style) */
  click(role: string, name: string): Promise<void>;
  fill(label: string, value: string): Promise<void>;
  /** AI/dynamic action: natural-language instruction (Claude-Chrome, or Playwright+MCP fallback) */
  act(instruction: string): Promise<void>;
  extract<T>(instruction: string, schema: ZodType<T>): Promise<T>;
  screenshot(path: string): Promise<void>;
  readPage(): Promise<{ url: string; title: string; text: string }>;
  setViewport(w: number, h: number): Promise<void>;
  close(): Promise<void>;
}
export interface BrowserLaunchOptions { headless: boolean; viewport: { width: number; height: number }; timeout: number; baseUrl?: string; }
```
> **Claude-Chrome engine note (WS-12):** the `claude-chrome` implementation maps `BrowserSession` methods onto the Claude-in-Chrome MCP tools — `tabs_create_mcp`/`navigate` → `goto`, `computer`/`find`+`form_input` → `click`/`fill`, `computer` (screenshot) → `screenshot`, `read_page`/`get_page_text` → `readPage`, and the agent's own reasoning drives `act`/`extract`. It requires a running Chrome with the Claude extension and site permissions; it is **local-first** (dev machine), not the CI default. Config selects it; CI keeps `playwright` headless.

### D.6 Reporter interface + four surfaces
`packages/core/src/reporter.ts`:
```ts
export interface Reporter {
  name: string;
  report(execution: TestExecution, ctx: ReportContext): Promise<void>;
}
export interface ReportContext {
  config: WardenConfig; prNumber?: number; headSha?: string;
  repo?: { owner: string; repo: string }; artifactsDir: string;
}
```
V1 concrete reporters (WS-14): `ctrf`, `githubJobSummary`, `prComment`, `checkRunAnnotations`.

### D.7 Agent strategy interface
`packages/core/src/agent.ts`:
```ts
export type StrategyName = 'exploratory' | 'generative' | 'healer';
export interface AgentStrategy {
  name: StrategyName;
  run(input: AgentInput): Promise<AgentOutput>;
}
export interface AgentInput {
  provider: LLMProvider; browser?: BrowserSession;
  diff?: DiffFile[]; changeSurface?: ChangeSurface;
  url?: string; failure?: FailureContext; config: WardenConfig;
}
export interface AgentOutput {
  findings: ExploratoryFinding[];      // exploratory
  generatedFiles?: { path: string; content: string }[]; // generative
  diagnosis?: HealerDiagnosis;         // healer
  markdownReport: string;
}
export interface ExploratoryFinding {
  title: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW';
  steps: string[]; expected: string; actual: string;
  screenshotPath?: string; requirementIds?: string[];
}
```

### D.8 Plugin API + config
`packages/core/src/plugin.ts` and `config.ts` — `QAPlatformPlugin` hooks (blueprint Part VIII) and `defineConfig(cfg): WardenConfig` with the full `WardenConfig` Zod schema (ai, browser, scope, tiers, reporting, gates, testManagement, plugins). `loadConfig(cwd): Promise<WardenConfig>` (uses c12) signature declared here, resolves `warden.config.ts` with defaults.

### D.9 Errors, logging, ids
`packages/core/src/errors.ts` (`WardenError`, `ConfigError`, `ProviderError`, `BrowserError`, `GateBlockedError`), `logger.ts` (leveled logger interface), `ids.ts` (deterministic id helpers — **no `Date.now()`/random in pure helpers**; ids derive from content/sequence).

### D.10 Stub factories (so wave 1 never blocks)
`packages/core/src/testing/fakes.ts` — `fakeProvider()`, `fakeBrowserSession()`, `fakeReporter()`, `fixtureChangeSurface()`, `fixtureExecution()`. Wave-1 agents import these to unit-test in isolation.

**WS-00 acceptance criteria:** every schema parses its blueprint example; every interface + factory is exported from `index.ts`; `defineConfig` applies documented defaults; `loadConfig` resolves a sample `warden.config.ts`; `pnpm --filter @warden/core test` green; **zero dependencies on any other `@warden/*` package.**

---

## Part E — Work-Streams

Each entry: **owns / depends on / contract / acceptance criteria / test cmd.** Contracts reference Part D types; agents implement, they do not redefine.

### WS-00 · `@warden/core` — Wave 0 (solo)
- **Owns:** `packages/core/**`, and the repo-root scaffolding: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.eslintrc`, `.prettierrc`, root `vitest` config.
- **Depends on:** nothing.
- **Contract:** all of **Part D**.
- **Acceptance:** Part D.10 above.
- **Test cmd:** `pnpm --filter @warden/core test`

### WS-10 · `@warden/orchestrator` — Wave 1
- **Owns:** `packages/orchestrator/**`.
- **Depends on:** `@warden/core`.
- **Contract / public API:**
  ```ts
  analyzeChangeSurface(baseSha: string, headSha: string, cwd?: string): Promise<ChangeSurface>;
  selectTiers(surface: ChangeSurface, cfg: WardenConfig): TestTier[];
  scoreRisk(surface: ChangeSurface, cfg: WardenConfig): { score: number; reasons: {...}[] };
  evaluateExitCriteria(execution: TestExecution, cfg: WardenConfig): GateDecision;
  dispatchAgents(surface, cfg): AgentPlan;   // which strategies to run at what risk
  ```
- **Acceptance:** diff→surface matches blueprint Part IV (shared paths escalate to full suite; module→tag derivation; API route extraction; risk scoring rules from blueprint Part VII); tier mapping (0–3 / 4–6 / 7–10); gate logic (CRITICAL→BLOCK, >2 HIGH→BLOCK, passRate<90%→BLOCK, HIGH→WARN). Pure functions, fully unit-tested with fixtures (no live git needed — accept a `DiffFile[]` provider injected for tests).
- **Test cmd:** `pnpm --filter @warden/orchestrator test`

### WS-11 · `@warden/agent` — Wave 1
- **Owns:** `packages/agent/**` (`providers/anthropic.ts`, `providers/base.ts`, `strategies/{exploratory,generative,healer}.ts`, `create-provider.ts`, `create-strategy.ts`).
- **Depends on:** `@warden/core`.
- **Contract:** `createProvider(cfg): LLMProvider` (v1 returns `AnthropicProvider`; factory throws `ProviderError` for unimplemented v2 providers with a helpful message); `createStrategy(name): AgentStrategy`; the three strategies implement `AgentStrategy` using the system prompts from blueprint Part III. Exploratory uses an injected `BrowserSession`; generative returns `generatedFiles`; healer consumes `FailureContext` and returns `HealerDiagnosis`.
- **Acceptance:** provider maps tools to Anthropic tool format and parses tool calls (tested against a recorded/faked HTTP layer — **no real API calls in unit tests**); each strategy produces the documented `AgentOutput` shape and a valid `markdownReport`; exploratory drives a `fakeBrowserSession` and emits `ExploratoryFinding[]` with severities; generative output is syntactically valid TS (`tests/e2e/*.spec.ts`) using role-based locators + `@smoke`/`@regression` tags; healer classifies regression-vs-maintenance.
- **Test cmd:** `pnpm --filter @warden/agent test`

### WS-12 · `@warden/runner` — Wave 1
- **Owns:** `packages/runner/**` (`engines/playwright.ts`, `engines/claude-chrome.ts`, `create-engine.ts`, `playwright-run.ts`, `api-run.ts`, `ctrf-adapter.ts`).
- **Depends on:** `@warden/core`.
- **Contract:** `createEngine(cfg): BrowserEngine` (returns Playwright or Claude-Chrome per `cfg.browser.engine`); `runPlaywright(opts): Promise<CTRFReport>` (shells Playwright with `--grep`, parses JSON → CTRF); `runApiTests(opts): Promise<CTRFReport>`. Both engines implement `BrowserSession` from D.5.
- **Acceptance:** Playwright engine performs real role-based click/fill/goto/screenshot against a local fixture page; `claude-chrome` engine implements every `BrowserSession` method by delegating to the Claude-in-Chrome MCP tool surface (unit-tested against a **faked MCP client** — the interface, not a live browser) and documents the "requires extension + site permission, local-first" caveat in its module header; `runPlaywright` converts Playwright JSON to valid CTRF (validated by core's CTRF schema). CI-safe tests never require a real Chrome extension.
- **Test cmd:** `pnpm --filter @warden/runner test`

### WS-13 · `@warden/test-management` — Wave 1
- **Owns:** `packages/test-management/**` (`store/sqlite.ts`, `store/yaml-cases.ts`, `migrations/*.sql`, `coverage.ts`, `flake.ts`).
- **Depends on:** `@warden/core`.
- **Contract:**
  ```ts
  class SqliteStore {
    constructor(dbPath: string);
    saveExecution(e: TestExecution): void;
    getRecentExecutions(testId: string, n: number): TestResult[];
    // + plans, requirements, results CRUD
  }
  loadYamlCases(dir: string): Promise<TestCase[]>;      // tests/cases/*.yaml
  computeCoverage(reqs: Requirement[], results: TestResult[]): Requirement[]; // sets coverageStatus
  computeFlakeRate(history: TestResult[]): number;
  shouldQuarantine(rate: number): boolean;              // 0.2 < rate < 0.8
  ```
- **Acceptance:** SQLite schema created via migrations; round-trip save/get executions; YAML cases parse to `TestCase` (validated by core schema); coverage matrix computes PASSED/FAILED/NOT_TESTED/PARTIAL per requirement; flake rate + quarantine thresholds match blueprint Part VII. Uses a temp db file per test.
- **Test cmd:** `pnpm --filter @warden/test-management test`

### WS-14 · `@warden/reporter` — Wave 1
- **Owns:** `packages/reporter/**` (`reporters/{ctrf,github-job-summary,pr-comment,check-run}.ts`, `aggregate.ts`, `create-reporters.ts`, `templates/pr-report.ts`).
- **Depends on:** `@warden/core`.
- **Contract:** each reporter implements `Reporter` (D.6); `createReporters(cfg): Reporter[]` from `cfg.reporting` flags; `aggregate(reportsDir): Promise<CTRFReport>`; `renderPrReport(execution, gate): string` produces the blueprint's Markdown PR report (risk score, bugs found, coverage table, traceability table, gate decision).
- **Acceptance:** CTRF reporter writes schema-valid JSON; job-summary reporter writes Markdown to `$GITHUB_STEP_SUMMARY` (path injectable for tests); PR-comment reporter builds the exact blueprint Markdown (snapshot-tested); check-run reporter builds the `octokit.checks.create` payload with file/line annotations (octokit injected/mocked — **no live GitHub calls in unit tests**); `aggregate` merges multiple CTRF files correctly.
- **Test cmd:** `pnpm --filter @warden/reporter test`

### WS-20 · `@warden/cli` (`warden`) — Wave 2
- **Owns:** `packages/cli/**` (`bin/warden.ts`, `commands/{analyze,run,agent,report,plan,init}.ts`).
- **Depends on:** core + all wave-1 packages.
- **Contract (commands):**
  - `warden analyze --base <sha> --head <sha> --output <file>` → writes `test_tags`, `risk_score`, `run_full_suite` (GitHub-Actions `$GITHUB_OUTPUT` format).
  - `warden run --grep <tags>` → runs runner, writes CTRF, invokes reporters.
  - `warden agent --strategy <exploratory|generative|healer> --url <url> [--pr-number N] --output <path>` → orchestrates provider+browser+strategy, writes report.
  - `warden report aggregate --reports <dir> --pr <n>` → aggregate + post gate comment.
  - `warden plan` → emit a Test Plan Markdown (blueprint Part I template).
  - `warden init` → scaffold `warden.config.ts` + sample workflow (the `create-warden-config` story).
- **Acceptance:** each command wires real wave-1 packages and runs against **example apps** (WS-30 provides them; CLI tests use a minimal fixture app); `warden analyze` output is consumable by GitHub Actions; `warden agent --strategy exploratory` produces a report JSON end-to-end using `fakeProvider` when `ANTHROPIC_API_KEY` is absent.
- **Test cmd:** `pnpm --filter @warden/cli test`

### WS-21 · `warden-action` (GitHub Action) — Wave 2
- **Owns:** `packages/github-action/**` (`action.yml`, `src/main.ts`, `dist/` build), and the reference workflow `examples/.github/workflows/ai-qa.yml`.
- **Depends on:** the CLI (invokes `warden` subcommands) + `@actions/core`.
- **Contract:** `action.yml` inputs (`provider`, `model`, `strategy`, `risk-threshold`, `anthropic-api-key`) and outputs (`gate`, `risk-score`, `report-path`); `main.ts` orchestrates the tiered jobs from blueprint Part IV (smoke → analyze → selective/exploratory/api → generate → qa-gate) by shelling the CLI and using octokit for PR comment + check run.
- **Acceptance:** the composite workflow YAML validates; `main.ts` produces the four reporting surfaces on a dry-run PR event fixture; the Action is loadable via a local `uses: ./packages/github-action`. Real Anthropic + real GitHub are exercised only in WS-30's dogfood run, not unit tests.
- **Test cmd:** `pnpm --filter warden-action test`

### WS-30 · Examples + Self-CI (dogfood) — Wave 3
- **Owns:** `examples/{next-app,express-api,monorepo}/**`, `examples/tests/**`, `.github/workflows/warden-selftest.yml`, `README.md` quick-start.
- **Depends on:** everything.
- **Contract:** three runnable example apps, each with `@smoke`/`@regression` Playwright tests + `tests/cases/*.yaml`; a demo PR script; Warden running on Warden's own repo.
- **Acceptance:** opening a demo PR on each example yields a real AI QA report (PR comment + job summary + check run); the self-test workflow is green; README "3 commands to first report" is accurate.
- **Test cmd:** `pnpm --filter examples test`

---

## Part F — V1 Definition of Done (exit checklist)
- [ ] `pnpm -w build && pnpm -w test && pnpm -w typecheck && pnpm -w lint` all green.
- [ ] `@warden/core` exports every Part D symbol; no `@warden/*` cross-deps except through core.
- [ ] Three strategies (`exploratory`/`generative`/`healer`) run via `warden agent`.
- [ ] Two browser engines (`playwright`, `claude-chrome`) implement `BrowserSession`; config selects; CI uses Playwright headless.
- [ ] Four reporting surfaces produce output on a PR (CTRF, job summary, PR comment, check-run annotations).
- [ ] Selective testing: PR diff → tags → scoped run; risk score → tier + AI dispatch.
- [ ] Git-YAML test cases + SQLite execution history + coverage matrix + flake quarantine work.
- [ ] `warden.config.ts` + plugin hooks drive provider/browser/reporter selection.
- [ ] Dogfood: Warden reviews its own PRs; three example apps each get a report.
- [ ] README: developer → first AI QA report in ≤10 minutes.

## Part G — Manifest
The machine-readable dispatch list is [`2026-07-07-warden-v1-swarm.manifest.yaml`](./2026-07-07-warden-v1-swarm.manifest.yaml). Keep it in lockstep with Part E: every work-stream here has exactly one manifest entry, and every `contract` field points to its `#ws-xx` anchor in this document.
