# Warden V2 — Parallel-Agent Build Spec

> V2 turns Warden from a CI-embedded QA agent into a **full platform**: multi-provider AI, a
> resilient hybrid browser engine, a persistent metrics dashboard with a real UI, session-recording
> test generation, performance + security tiers, and two-way issue-tracker sync.
>
> **This is a swarm build spec, like [V1](./2026-07-07-warden-v1-design.md).** V2 is **additive**:
> it extends `@warden/core`'s contracts without breaking any V1 signature, then fans out a large
> wave of mostly-independent packages. The centerpiece — the **Requirements Traceability
> dashboard** — is dressed by the **"Sentinel" design system** (delivered as the design artifact and
> the `@warden/design-system` package, WS2-18). Machine-readable companion:
> [`2026-07-07-warden-v2-swarm.manifest.yaml`](./2026-07-07-warden-v2-swarm.manifest.yaml).

- **Status:** approved design, ready to plan/build (after V1)
- **Date:** 2026-07-07
- **Depends on:** V1 shipped (all `@warden/*` V1 packages exist and are green)
- **Guiding rule (unchanged from V1):** contract-first waves; disjoint ownership; test against fakes.

---

## Part A — V2 Feature Set (what ships)

| # | Feature | Work-stream | Wave |
|---|---------|-------------|------|
| 1 | **Multi-provider AI** — OpenAI, Gemini, Ollama, drop-in via config | `WS2-10` `agent/providers/*` | 1 |
| 2 | **Stagehand hybrid engine** — Playwright for stable flows, AI `act()` for dynamic | `WS2-11` `runner/engines/stagehand` | 1 |
| 3 | **Observability** — Prometheus pushgateway + Grafana dashboards, one-command compose | `WS2-12` `@warden/observability` | 1 |
| 4 | **Issue-tracker sync** — Linear, Jira, GitHub Projects, requirements auto-linked | `WS2-13` `@warden/integrations` | 1 |
| 5 | **Session recording** — record traffic → auto-generate tests (Meticulous-style) | `WS2-14` `@warden/recorder` | 1 |
| 6 | **Performance testing** — k6 smoke/load gates | `WS2-15` `runner/k6` | 1 |
| 7 | **Security scanning** — OWASP ZAP API scan per PR | `WS2-16` `runner/security` | 1 |
| 8 | **Mobile + multi-browser** — Appium (iOS/Android) + Firefox/WebKit matrix | `WS2-17` `runner/appium` + matrix | 1 |
| 9 | **Sentinel design system** — tokens + components (the anti-slop identity) | `WS2-18` `@warden/design-system` | 1 |
| 10 | **Requirements Traceability dashboard** — Next.js UI, the platform's face | `WS2-20` `apps/dashboard` | 2 |
| 11 | **Docs site + one-command deploy** — Docusaurus + compose deployment | `WS2-30` docs/examples | 3 |

Each maps to a `BrowserEngine`/`LLMProvider`/`Reporter`/plugin seam that **V1 already defined** — V2 is filling in the seams, which is exactly why the V1 abstractions exist.

---

## Part B — V2 Waves

| Wave | Work-streams | Parallelism | Barrier |
|------|--------------|-------------|---------|
| **0** | `WS2-00 core-v2` (additive contract extensions) | 1 (solo) | core builds; **no V1 signature changed**; new exports frozen |
| **1** | `WS2-10..18` (9 streams) | up to 9 agents parallel | each package builds + unit-tests green against core-v2 |
| **2** | `WS2-20 dashboard`, `WS2-21 dashboard-api` | 2 agents parallel | dashboard renders live data in Sentinel themes |
| **3** | `WS2-30 docs + examples + deploy` | 1–2 agents | one-command self-host stack; docs published |

Same protocol as V1 Part B: disjoint ownership, contract-first, worktree isolation, uniform DoD, wave barriers. **The extra V2 rule:** `WS2-00` may only *add* to `@warden/core`; changing an existing V1 signature is forbidden (it would break shipped V1). Additive-only keeps V1 and V2 co-installable.

---

## Part C — `WS2-00` core-v2 contract extensions (Wave 0, solo)

Additively extends `@warden/core`. New exports:

```ts
// Provider registry — turns the V1 factory into a pluggable registry
export interface ProviderRegistry { register(name: string, factory: ProviderFactory): void; create(cfg): LLMProvider; }

// Metrics seam for observability (WS2-12)
export interface MetricsEmitter {
  emitExecution(e: TestExecution): Promise<void>;   // pass rate, duration, flake, coverage delta
  emitGate(d: GateDecision, meta: { pr?: number; module?: string }): Promise<void>;
}

// Dashboard data contract (WS2-20/21 implement; core only declares the shape)
export interface DashboardDataApi {
  listRequirements(filter?: CoverageFilter): Promise<Requirement[]>;
  coverageMatrix(): Promise<CoverageCell[]>;             // requirement × test × last result
  executions(range: DateRange): Promise<TestExecution[]>;
  flakeBoard(): Promise<FlakeStat[]>;
  trends(metric: TrendMetric, range: DateRange): Promise<TrendPoint[]>;
}

// Integration seam (WS2-13)
export interface IntegrationAdapter {
  name: 'linear' | 'jira' | 'github-projects';
  fetchRequirements(): Promise<Requirement[]>;
  pushResult(reqId: string, status: CoverageStatus): Promise<void>;
}

// Recorder seam (WS2-14)
export interface SessionRecorder { record(url: string, opts): Promise<RecordedSession>; }
export interface TestSynthesizer { synthesize(s: RecordedSession, provider: LLMProvider): Promise<GeneratedTest[]>; }
```

Plus additive `WardenConfig` fields: `observability`, `dashboard`, `recorder`, `integrations`, `performance`, `security`, `mobile`, and provider config for `openai`/`gemini`/`ollama` (the V1 schema already reserved `ai.provider` values). **Acceptance:** all new symbols exported; every V1 test still green; `defineConfig` back-compatible.

---

## Part D — Wave-1 Work-Streams

Each: owns / depends / contract / acceptance. All depend only on `@warden/core` (v2) unless noted.

### WS2-10 · Multi-provider AI — `@warden/agent/providers`
- **Owns:** `packages/agent/src/providers/{openai,gemini,ollama}.ts`, provider registry wiring.
- **Contract:** each implements `LLMProvider` (`generateText`, `generateWithTools`, optional `streamText`); registered so `createProvider({provider:'openai'|...})` returns them; tool-format mapping per SDK.
- **Acceptance:** each provider maps `Tool[]` to its native tool schema and parses tool calls (faked HTTP; no live keys in tests); Ollama hits `/api/generate` against a faked server; config `fallbackProvider` falls back to Ollama when the primary key is missing; parity test: same prompt → same `AgentOutput` shape across providers.
- **Test:** `pnpm --filter @warden/agent test`

### WS2-11 · Stagehand hybrid engine — `@warden/runner/engines/stagehand`
- **Owns:** `packages/runner/src/engines/stagehand.ts`.
- **Contract:** implements `BrowserEngine`/`BrowserSession`; deterministic steps go through Playwright, `act()`/`extract()` route to Stagehand AI primitives (blueprint Part III hybrid).
- **Acceptance:** `click`/`fill`/`goto` use Playwright; `act`/`extract` call a faked Stagehand client and return zod-validated results; engine selected by `cfg.browser.engine === 'stagehand'`; documents the "80% deterministic / 20% AI" split.
- **Test:** `pnpm --filter @warden/runner test`

### WS2-12 · Observability — `@warden/observability`
- **Owns:** `packages/observability/**`, `monitoring/{prometheus.yml,dashboards/*,provisioning/*}`, `docker-compose.yml` (pushgateway/prometheus/grafana per blueprint Part VI).
- **Contract:** implements `MetricsEmitter` (pushes to Prometheus pushgateway); ships a provisioned Grafana dashboard (pass rate, flake rate, MTTR, escaped-defect rate, suite-duration trend, coverage delta).
- **Acceptance:** emitter formats + pushes metrics to a faked pushgateway; dashboard JSON is valid Grafana; `docker compose up` brings the stack up (smoke-checked in CI via compose config validation, not a full boot).
- **Test:** `pnpm --filter @warden/observability test`

### WS2-13 · Issue-tracker sync — `@warden/integrations`
- **Owns:** `packages/integrations/**` (`linear.ts`, `jira.ts`, `github-projects.ts`).
- **Contract:** each implements `IntegrationAdapter` (`fetchRequirements`, `pushResult`); config `testManagement.requirementsSource` selects one.
- **Acceptance:** each adapter maps its API objects → `Requirement`; `pushResult` updates external status (mocked HTTP); round-trips against recorded fixtures; no live tokens in tests.
- **Test:** `pnpm --filter @warden/integrations test`

### WS2-14 · Session recording → tests — `@warden/recorder`
- **Owns:** `packages/recorder/**`.
- **Contract:** `SessionRecorder.record` captures a browsing session (Playwright tracing / HAR); `TestSynthesizer.synthesize` turns it into `GeneratedTest[]` (Playwright specs) via a provider.
- **Acceptance:** recorder produces a `RecordedSession` from a faked trace; synthesizer emits valid, tagged spec files (role-based locators); dedupes overlapping flows.
- **Test:** `pnpm --filter @warden/recorder test`

### WS2-15 · Performance (k6) — `@warden/runner/k6`
- **Owns:** `packages/runner/src/perf/**`, `examples/perf/*.js`.
- **Contract:** `runK6(script, thresholds): Promise<CTRFReport>`; perf tier gate (p95 latency / throughput thresholds → PASS/WARN/BLOCK).
- **Acceptance:** parses k6 JSON summary → CTRF; thresholds evaluated to a `GateDecision`; runs a trivial script in CI.
- **Test:** `pnpm --filter @warden/runner test`

### WS2-16 · Security (OWASP ZAP) — `@warden/runner/security`
- **Owns:** `packages/runner/src/security/**`.
- **Contract:** `runZapBaseline(url): Promise<CTRFReport>`; maps ZAP alerts → findings with OWASP category + severity.
- **Acceptance:** parses ZAP JSON → CTRF findings; severity mapping; high-severity alert → gate BLOCK per config.
- **Test:** `pnpm --filter @warden/runner test`

### WS2-17 · Mobile + multi-browser matrix — `@warden/runner/appium` + matrix
- **Owns:** `packages/runner/src/mobile/**`, matrix config in `packages/runner/src/matrix.ts`.
- **Contract:** Appium `BrowserSession` for iOS Simulator/Android; Playwright project matrix for Firefox/WebKit.
- **Acceptance:** matrix expands `chromium|firefox|webkit` from config; Appium session implements `BrowserSession` (faked driver); mobile viewport parity with V1.
- **Test:** `pnpm --filter @warden/runner test`

### WS2-18 · Sentinel design system — `@warden/design-system`
- **Owns:** `packages/design-system/**` (`tokens/`, `themes/`, `components/`, `logo/`).
- **Contract:** exports the **Sentinel** design tokens (the values from the design artifact: status-semantic color roles `PASS/FAIL/FLAKY/BLOCKED/SKIPPED/QUARANTINED`, base/ink/accent, type scale, spacing, radii), theme definitions (Sentinel dark default + light + high-contrast), the **Warden portcullis logo** as SVG components, and headless-styled primitives the dashboard consumes (VerdictCard, StatusPill, CoverageMatrix, TestResultRow, TrendTile, ThemeToggle).
- **Acceptance:** tokens exported as CSS variables + a TS token object; themes swap via `data-theme`; every status role passes WCAG AA on its surface in all themes; logo renders at 16/24/32/full lockup; components are visually verified against the design artifact.
- **Test:** `pnpm --filter @warden/design-system test` (token + a11y-contrast tests) + Storybook/visual snapshot.

---

## Part E — Wave-2 Work-Streams (the UI)

### WS2-20 · Requirements Traceability dashboard — `apps/dashboard`
- **Owns:** `apps/dashboard/**` (Next.js app).
- **Depends on:** `@warden/design-system` (WS2-18), `@warden/test-management`, `@warden/observability`, core-v2 `DashboardDataApi`.
- **Contract:** implements the screens that make Warden legible: **Coverage Matrix** (requirement × test × last result, the Xray-killer view), **Execution history & trends**, **Flake board / quarantine**, **PR gate timeline**, **Requirement drill-down** (traceability chain Requirement→Test→Execution→Result). All rendered in Sentinel themes with the theme toggle.
- **Acceptance:** reads live data via `DashboardDataApi`; coverage matrix filters by module/status; trends chart pass-rate/flake/MTTR over time; fully responsive; dark (default)/light/high-contrast themes; keyboard-navigable; matches the Sentinel artifact.
- **Test:** `pnpm --filter dashboard test` + Playwright E2E on the dashboard itself (dogfood).

### WS2-21 · Dashboard data API — `@warden/dashboard-api`
- **Owns:** `packages/dashboard-api/**` (server routes / adapters).
- **Depends on:** `@warden/test-management`, `@warden/observability`.
- **Contract:** concrete `DashboardDataApi` over SQLite store + Prometheus; consumed by `apps/dashboard` server components.
- **Acceptance:** every `DashboardDataApi` method returns validated shapes from real store data; pagination + date-range filters; unit-tested against a seeded temp store.
- **Test:** `pnpm --filter @warden/dashboard-api test`

---

## Part F — Wave-3

### WS2-30 · Docs + examples + one-command deploy
- **Owns:** `docs-site/**` (Docusaurus), `examples/**` updates, `deploy/**` (compose for the full self-host stack: app + dashboard + observability).
- **Acceptance:** `docker compose -f deploy/docker-compose.yml up` brings up Warden + dashboard + Grafana; docs cover install, config, providers, dashboard, plugins; examples demonstrate every V2 tier.
- **Test:** `pnpm --filter docs-site build` + compose config validate.

---

## Part G — V2 Definition of Done
- [ ] All V1 tests still green (V2 changed no V1 signature).
- [ ] Four providers selectable via config (anthropic + openai + gemini + ollama) with fallback.
- [ ] Three browser engines (playwright, claude-chrome, stagehand) implement `BrowserSession`.
- [ ] Observability stack + Grafana dashboard provisioned by one compose command.
- [ ] Dashboard renders the coverage matrix, trends, flake board, and gate timeline in Sentinel themes.
- [ ] Issue-tracker sync (≥1 of Linear/Jira/GH Projects) round-trips requirements.
- [ ] Session recording generates runnable tests; k6 + ZAP tiers gate PRs; Appium + multi-browser matrix run.
- [ ] `@warden/design-system` is the single source of truth for the Sentinel identity; dashboard consumes it.
- [ ] Docs site published; one-command self-host works.

## Part H — Manifest
Machine-readable dispatch list: [`2026-07-07-warden-v2-swarm.manifest.yaml`](./2026-07-07-warden-v2-swarm.manifest.yaml). One entry per work-stream here; `contract` fields anchor back into this document.
