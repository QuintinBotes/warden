# Proposal: Test Data Management & Environment Provisioning

- Status: Draft (design proposal) · Date: 2026-07-08 · Relates to: warden-next-competitive-gaps.md §1.3

## Summary

This proposal adds a `DataProvider` seam and a new `@warden/fixtures` package that give every Test
Set declarative, isolated seed/teardown data — via SQL, an API call, or a Testcontainers-backed
ephemeral service — plus a per-run namespace so parallel executions never collide. The same fixture
catalog is handed to the exploratory and generative agents so AI-written and AI-driven tests use
real seeded records (a known customer id, a real SKU) instead of inventing hard-coded values that
break the moment the schema or seed data drifts.

## Motivation

Warden already decides _which_ tests to run (the orchestrator's change surface and tier selection)
and _how well_ they're covered (the coverage matrix), but it has no opinion on _what data_ those
tests run against. Per §1.3 of the competitive gap analysis: "Flaky, order-dependent tests almost
always trace to shared/dirty data. Real E2E needs seeded, isolated data + a known environment,"
citing mabl's data-driven tables, Testim, most enterprise suites, and ephemeral-environment tooling
(Preview environments, Testcontainers) as the bar. Today a Warden-generated Playwright spec either
invents a plausible-looking value (`test@example.com`, `SKU-001`) that may not exist in the target
environment, or a team hand-maintains seed scripts outside Warden entirely — invisible to the
orchestrator, undocumented, and a common source of the "works locally, flaky in CI" class of bug
this project already tracks via flake quarantine (§1.4). Closing this gap makes generated tests
runnable against a real, isolated dataset on the first try, and makes parallel CI runs
data-safe by construction.

## Goals

1. A declarative way to describe, per Test Set (a tagged group of `TestCase`s), what data must
   exist before its tests run and how to remove it afterward.
2. Three built-in seed/teardown mechanisms — SQL script, HTTP/API call, and a Testcontainers-backed
   ephemeral service — behind one `DataProvider` interface, selected by config.
3. Per-run namespacing so two runs (e.g. two PRs' selective tiers, or parallel shards of the same
   tier) never read or clobber each other's seeded rows/records.
4. A `FixtureCatalog` — the resolved, run-scoped record set — exposed to the exploratory and
   generative agent strategies via `AgentInput`, so generated assertions and interactions reference
   real seeded values instead of literals.
5. Guaranteed teardown: fixtures are torn down even when the test run fails or times out.
6. Fully hermetic unit tests — no real database, HTTP endpoint, or Docker daemon required to test
   the engine itself.

## Non-Goals

- A general-purpose database migration or schema-management tool. `DataProvider` seeds and tears
  down _data_, not schema.
- Full environment provisioning (spinning up an entire preview deployment of the app under test).
  Testcontainers support here is scoped to backing services (Postgres, Redis, a mock third-party
  API) that a `DataProvider` seeds into — not the application itself.
- A data masking/anonymization or synthetic-data-generation product. Fixture _values_ are
  author-declared or LLM-drafted from a schema hint; this proposal does not add a PII-scrubbing
  pipeline.
- Cross-repo fixture sharing (that's a future extension once `@warden/coverage-sync`-style repo
  links are proven useful for data, not just tests/docs).

## Architecture

One new package, plus small additive extensions to `@warden/core`, `@warden/test-management`,
`@warden/agent`, and `@warden/cli`.

### New: `@warden/fixtures`

The data-provisioning engine, as small isolated units. No live database, HTTP client, or Docker
daemon of its own — every backend (SQL executor, HTTP client, container runtime) is injected, so
the whole engine is unit-testable without any of them running.

| Unit                         | Does                                                                                                                                                                                                                                                                             | Depends on                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `FixtureRegistry`            | `(FixtureDef[]) → Map<testSetTag, FixtureDef>` — loads and indexes `tests/fixtures/*.yaml` by the Test Set tag(s) they apply to.                                                                                                                                                 | core                                                |
| `RunNamespace`               | `(triggerRef, shardId?) → Namespace` — derives a short, deterministic, collision-safe namespace (e.g. `pr-482-shard-1-a1b2c3`) used to prefix/suffix every seeded identifier.                                                                                                    | ids                                                 |
| `SqlDataProvider`            | `DataProvider` impl — runs a namespaced seed script (`{{ns}}` template) via an injected `SqlExecutor`, and the paired teardown script on cleanup.                                                                                                                                | injected `SqlExecutor`                              |
| `ApiDataProvider`            | `DataProvider` impl — calls a seed endpoint and a teardown endpoint via an injected `HttpClient`, templating the namespace into the request body/path.                                                                                                                           | injected `HttpClient`                               |
| `TestcontainersDataProvider` | `DataProvider` impl — starts a declared container image (via an injected `ContainerRuntime`), waits for its health check, seeds into it (delegating to `SqlDataProvider`/`ApiDataProvider` against the container's mapped port), and stops the container on cleanup.             | injected `ContainerRuntime`, delegates to the above |
| `FixtureOrchestrator`        | `(FixtureCatalogRequest, DataProvider[]) → FixtureCatalog` — resolves which fixtures a Test Set needs, seeds them in declared order, and builds the resolved `FixtureCatalog`; `.teardown()` runs teardown in reverse order and never throws (errors are collected, not raised). | registry, providers                                 |
| `FixtureCatalogReader`       | `(FixtureCatalog) → prompt-ready summary` — renders the catalog as a compact, LLM-friendly description (entity → field → example value) for `AgentInput.fixtures`.                                                                                                               | core                                                |

`DataProvider` is the swappable seam (config-selected, exactly like `LLMProvider`/`BrowserEngine`):

```ts
// @warden/core/src/fixtures.ts (new, additive)

export type FixtureBackend = 'sql' | 'api' | 'testcontainers';

/** One seed-able unit: a table/entity's rows, or an API resource, scoped to a run namespace. */
export interface FixtureRecord {
  entity: string; // e.g. "customer", "order"
  key: string; // stable handle a test/agent references, e.g. "primaryCustomer"
  fields: Record<string, string | number | boolean | null>;
}

export interface FixtureDef {
  id: string; // e.g. "checkout-happy-path"
  /** Test Set tags this fixture applies to, matching `TestCase.tags` (e.g. '@apps/checkout'). */
  appliesTo: string[];
  backend: FixtureBackend;
  /** SQL script (sql), request template (api), or container spec (testcontainers). */
  seed: string;
  teardown: string;
  /** Declares the records this fixture makes available, for the fixture catalog / agents. */
  provides: FixtureRecord[];
  /** For `testcontainers`: the image + health check + port to seed into. */
  container?: { image: string; healthCheckUrl?: string; port: number };
}

export interface FixtureCatalogRequest {
  testTags: string[]; // from ChangeSurface.testTags / a TestPlan's tags
  namespace: string; // from RunNamespace
}

/** The resolved, run-scoped data a test run (and the agents) can use. */
export interface FixtureCatalog {
  namespace: string;
  records: FixtureRecord[]; // fields already namespaced (e.g. email includes the namespace)
  /** Resolve a record by its declared key, e.g. catalog.get('primaryCustomer'). */
  get(key: string): FixtureRecord | undefined;
}

export interface DataProvider {
  backend: FixtureBackend;
  supports(def: FixtureDef): boolean;
  seed(def: FixtureDef, namespace: string): Promise<FixtureRecord[]>;
  teardown(def: FixtureDef, namespace: string): Promise<void>;
}
```

### Additive `@warden/core` extension: `AgentInput.fixtures`

```ts
// packages/core/src/agent.ts — additive field, optional so existing callers are unaffected
export interface AgentInput {
  provider: LLMProvider;
  browser?: BrowserSession;
  diff?: DiffFile[];
  changeSurface?: ChangeSurface;
  url?: string;
  failure?: FailureContext;
  config: WardenConfig;
  /** Run-scoped seeded data the exploratory/generative strategies should reference. */
  fixtures?: FixtureCatalog;
}
```

The generative strategy's prompt is extended (in `@warden/agent`, not `@warden/core`) to include the
`FixtureCatalogReader` summary when `fixtures` is present, with an explicit instruction: prefer
`catalog.get('<key>')`-sourced values over invented literals, and — for readability of the emitted
spec — inline the concrete namespaced value with a comment noting its fixture key
(`// seeded: primaryCustomer`). The exploratory strategy receives the same summary so its findings
can reference real record identifiers ("order ORD-pr482-041 stuck in `pending`") instead of
guessing at ones from the page.

### Additive `@warden/test-management` extension

`TestCase.tags` already carries the `@module` tags the orchestrator uses for tag-based test
selection (`scope.tagPrefix`); `FixtureDef.appliesTo` reuses that same tag vocabulary, so a fixture
is scoped to "every test tagged `@apps/checkout`" with no new correlation concept to learn. No
schema change is required in `@warden/test-management` itself — `FixtureRegistry` simply reads
`tests/fixtures/*.yaml` next to `testManagement.testCasesDir` and cross-references tags already
present in loaded `TestCase`s.

## Configuration

Additive `warden.config` block:

```ts
fixtures: {
  enabled: true,
  dir: 'tests/fixtures/',       // where FixtureDef YAML files live
  defaultBackend: 'sql',        // used when a FixtureDef omits `backend`
  namespaceStrategy: 'per-run', // 'per-run' | 'per-shard' — see Data flow
  sql: {
    connectionEnvVar: 'WARDEN_FIXTURES_DB_URL', // never store credentials in warden.config
  },
  api: {
    baseUrlEnvVar: 'WARDEN_FIXTURES_API_URL',
    authHeaderEnvVar: 'WARDEN_FIXTURES_API_TOKEN',
  },
  testcontainers: {
    enabled: false,             // opt-in: requires a Docker-compatible daemon in CI
    reuseAcrossShards: false,   // when true, one container backs all shards of a tier
  },
  teardown: {
    onFailure: 'always',        // 'always' | 'never' | 'onSuccessOnly' — see Safety
    timeoutMs: 30000,
  },
}
```

All fields have defaults (`enabled: false` at the top so zero-config repos are unaffected);
`testcontainers.enabled` defaults `false` because it requires CI infrastructure most repos won't
have on day one.

## Data flow

1. A PR triggers a Warden run (`runRun`/`runAgent` from `@warden/cli`, same entry points used
   today); the orchestrator has already computed the `ChangeSurface` (`testTags`) and selected a
   tier.
2. `RunNamespace` derives a namespace from the trigger (`triggerRef` + tier + shard index when
   `namespaceStrategy: 'per-shard'`), e.g. `pr482-selective-s2-f91a`.
3. `FixtureRegistry` loads `tests/fixtures/*.yaml`, and `FixtureOrchestrator.resolve({ testTags,
namespace })` selects every `FixtureDef` whose `appliesTo` intersects the tier's `testTags`.
4. For each selected `FixtureDef`, the configured `DataProvider` (`SqlDataProvider`,
   `ApiDataProvider`, or `TestcontainersDataProvider`) seeds it, namespacing identifiers/values so
   this run's rows are unique (e.g. a customer email becomes `primary+pr482-selective-s2-f91a@test.warden`).
   `TestcontainersDataProvider` additionally starts and health-checks its container first.
5. The resulting `FixtureCatalog` is: (a) written to the run's artifacts dir as JSON, so the actual
   Playwright spec files loaded by `@warden/runner` can `import` and reference it directly by key,
   and (b) passed into `AgentInput.fixtures` for the exploratory/generative strategy run.
6. `@warden/runner` executes the tier's tests as today (Playwright/Claude-Chrome/Stagehand), now
   against seeded, namespaced data; results still convert to CTRF exactly as before — this proposal
   changes what data a test sees, not how results are reported.
7. After the run completes (pass, fail, or timeout), `FixtureOrchestrator.teardown()` runs every
   provider's teardown in reverse seed order, governed by `fixtures.teardown.onFailure`. Teardown
   errors are collected into the run's `AgentOutput`/log, never thrown — a teardown failure must not
   mask or block on the test result itself.
8. The merge gate and reporters are unaffected: `GateDecision` is still computed from `TestResult[]`
   exactly as before. A teardown failure is surfaced only as a `WARN`-level annotation in the report
   (via the existing `checkRunAnnotations` surface), not a gate block.

## Units & files

| File                                                        | Responsibility                                                                                                                                                        | Deps                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/core/src/fixtures.ts`                             | `FixtureDef`, `FixtureRecord`, `FixtureCatalog`, `FixtureCatalogRequest`, `DataProvider`, `FixtureBackend` types; additive `AgentInput.fixtures` field in `agent.ts`. | none (leaf)                        |
| `packages/core/src/config.ts`                               | Additive `fixtures` config block (`WardenConfigSchema`).                                                                                                              | zod                                |
| `packages/fixtures/src/registry.ts`                         | `FixtureRegistry` — load + parse + tag-index `FixtureDef` YAML.                                                                                                       | core, js-yaml                      |
| `packages/fixtures/src/namespace.ts`                        | `RunNamespace` — deterministic namespace derivation from trigger ref + tier + shard.                                                                                  | core/ids                           |
| `packages/fixtures/src/providers/sql.ts`                    | `SqlDataProvider` — templated seed/teardown SQL against an injected `SqlExecutor`.                                                                                    | core                               |
| `packages/fixtures/src/providers/api.ts`                    | `ApiDataProvider` — templated seed/teardown HTTP calls against an injected `HttpClient`.                                                                              | core                               |
| `packages/fixtures/src/providers/testcontainers.ts`         | `TestcontainersDataProvider` — container lifecycle via an injected `ContainerRuntime`, delegates seeding to `sql.ts`/`api.ts`.                                        | core, providers/sql, providers/api |
| `packages/fixtures/src/orchestrator.ts`                     | `FixtureOrchestrator` — resolve tags → seed in order → build `FixtureCatalog`; `.teardown()` with error collection.                                                   | registry, namespace, providers     |
| `packages/fixtures/src/catalog-reader.ts`                   | `FixtureCatalogReader` — render a `FixtureCatalog` as an LLM-prompt-ready summary.                                                                                    | core                               |
| `packages/fixtures/src/index.ts`                            | Public exports + `createFixtureProviders(cfg): DataProvider[]` factory (mirrors `createEngine`/`createProvider` in other packages).                                   | all of the above                   |
| `packages/agent/src/strategies/generative.ts` _(extended)_  | Includes the `FixtureCatalogReader` summary in the generation prompt when `input.fixtures` is set; instructs the model to reference `catalog.get(key)` values.        | fixtures (type-only), llm          |
| `packages/agent/src/strategies/exploratory.ts` _(extended)_ | Same summary included in the exploration prompt/context for grounded findings.                                                                                        | fixtures (type-only)               |
| `packages/cli/src/run-run.ts` _(extended)_                  | Resolves the namespace, seeds via `FixtureOrchestrator`, writes `fixture-catalog.json` to `artifactsDir`, guarantees `teardown()` in a `finally`.                     | fixtures                           |
| `packages/cli/src/run-agent.ts` _(extended)_                | Accepts an injected/resolved `FixtureCatalog` and forwards it as `AgentInput.fixtures`.                                                                               | fixtures (type-only)               |

## Safety & error handling

- **Teardown is guaranteed, not best-effort in the happy path** — `FixtureOrchestrator.teardown()`
  runs inside a `finally` around the test-run step in `run-run.ts`, so a test failure, a timeout, or
  a process signal handled upstream still triggers cleanup for whatever finished seeding.
- **Teardown never throws** — each provider's teardown error is caught and collected; a partial
  cleanup failure is reported (WARN annotation, listed by fixture id) rather than crashing the run
  or hiding a real test result behind a cleanup exception.
- **Namespacing prevents cross-run collision by construction** — every seeded value that must be
  unique (emails, external ids, container ports) is derived from `RunNamespace`, not left to the
  fixture author to remember; `SqlDataProvider`/`ApiDataProvider` reject a `FixtureDef` whose seed
  template doesn't reference `{{ns}}` when `fixtures.enabled` is true and the def declares
  `provides` fields that look identity-like (email/username patterns) — a lint-time warning, not a
  hard failure, to avoid false positives.
- **No secrets in `warden.config`** — connection strings and API tokens are always read from the
  env vars named in config (`connectionEnvVar`, `authHeaderEnvVar`), never inlined; `defineConfig`
  validation rejects a literal-looking secret in those fields (basic heuristic: `postgres://` or
  `Bearer ` prefix in the config value itself).
- **Testcontainers failures degrade to a clear `BLOCKED` tier, not a silent skip** — if the
  container fails its health check within `teardown.timeoutMs`, the tier's `TestExecution` is marked
  with a synthetic `BLOCKED` result explaining why, rather than running the tier against absent data
  and reporting confusing failures.
- **Bounded seed order** — `FixtureOrchestrator` detects and rejects cycles in `FixtureDef`
  dependencies (a fixture that reads another fixture's `provides` in its own `seed` template) at
  resolve time, with a clear `WardenError('E_FIXTURE_CYCLE', ...)`.

## Testing

Fully hermetic, matching the rest of Warden — every collaborator is injected:

- `RunNamespace`: fixed `triggerRef`/tier/shard inputs → deterministic, collision-free namespace
  strings; asserts two different shards of the same PR never produce the same namespace.
- `FixtureRegistry`: an in-memory/temp-dir fixture-YAML fixture set → correct tag-indexed `FixtureDef[]`;
  invalid YAML → `WardenError('E_FIXTURE_INVALID', ...)`.
- `SqlDataProvider` / `ApiDataProvider`: injected fake `SqlExecutor` / `HttpClient` recording calls →
  assert the seed/teardown template is rendered with the namespace substituted, called in the right
  order, and that `provides` records come back namespaced.
- `TestcontainersDataProvider`: injected fake `ContainerRuntime` (start/healthCheck/stop, no real
  Docker) → asserts start-before-seed, health-check-before-seed, and stop-after-teardown ordering;
  a fake that fails its health check asserts the `BLOCKED`-result behavior above.
- `FixtureOrchestrator`: fixture-def fixtures + `fakeProvider`-style injected `DataProvider[]` →
  correct `FixtureCatalog` shape, correct teardown-in-reverse-order, and a teardown error from one
  provider does not stop the others from tearing down (collected, not thrown).
- `FixtureCatalogReader`: a sample `FixtureCatalog` → asserts the rendered summary contains every
  record's key/entity/example value and stays under a documented size cap (bounded prompt size).
- `run-run.ts` (extended): injected `FixtureOrchestrator` + a `runTests` that throws → asserts
  `teardown()` is still called (the `finally` behavior) and the thrown error still propagates.
- `run-agent.ts` (extended): asserts an injected `FixtureCatalog` reaches `AgentInput.fixtures`
  unchanged when present, and is simply absent (not `undefined`-crashing) when fixtures are disabled.
- `generative.ts` / `exploratory.ts` prompt assembly: `fakeProvider()` captures the prompt sent →
  asserts the fixture summary is present when `input.fixtures` is set and absent otherwise, keeping
  strategy behavior backward-compatible for repos that don't configure fixtures.

No unit test opens a real database connection, makes a real HTTP call, or starts a real container;
`SqlExecutor`, `HttpClient`, and `ContainerRuntime` are minimal injected interfaces with hand-written
fakes in `@warden/fixtures`'s test files, matching the `fakeProvider`/`FileAccess`/`GitHubAccess`
pattern used elsewhere in the codebase.

## Rollout

1. Ship `@warden/core`'s additive types (`fixtures.ts`, `AgentInput.fixtures`, config block) and
   `@warden/fixtures` with `SqlDataProvider` + `ApiDataProvider` only — no Testcontainers yet —
   fully hermetically tested, no CI infrastructure required to adopt.
2. Wire `run-run.ts` / `run-agent.ts` in `@warden/cli` and extend the generative/exploratory prompts;
   dogfood on Warden's own selective tier with a small SQLite-backed fixture set.
3. Add `TestcontainersDataProvider` behind `fixtures.testcontainers.enabled: false` by default;
   document the CI Docker-daemon requirement.
4. Document `tests/fixtures/*.yaml` authoring and the fixture catalog in `docs/configuration.md`,
   with a worked example per backend.

## Risks & open items

- **SQL/API seed scripts are still hand-authored** — this proposal does not auto-generate a seed
  script from a schema; teams write `FixtureDef.seed`/`teardown` themselves (or an LLM drafts a
  first version from a schema hint, reviewed like generated tests). Full synthetic-data generation
  is future work.
- **Testcontainers in CI is an infrastructure dependency**, not a zero-config addition — some CI
  runners lack a usable Docker daemon; the feature is opt-in and the tier is marked `BLOCKED` with a
  clear reason rather than failing opaquely when it's unavailable.
- **Namespacing collisions in the _target system itself_** — this design assumes the seeded
  system tolerates namespaced values (e.g. a unique-email constraint accepts `+namespace` suffixes);
  a system with stricter identity constraints may need bespoke `FixtureDef` templates rather than a
  generic namespace substitution.
- **Fixture catalog size vs. prompt budget** — a large catalog must stay within the
  `FixtureCatalogReader`'s documented cap; very data-heavy Test Sets may need curated `provides`
  lists rather than exposing every seeded row to the agent.
- **`reuseAcrossShards` correctness** — sharing one Testcontainers instance across shards trades
  startup cost for a shared-state risk the per-shard namespace strategy is designed to avoid;
  it's opt-in and documented as such, not the default.
