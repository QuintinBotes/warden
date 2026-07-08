# Proposal: Test-Management Sync (external spec source of truth)

- **Status:** Draft (design proposal) · **Date:** 2026-07-08 · **Relates to:** warden-next-competitive-gaps.md §2.1

## Summary

Many teams keep their tests and specs in a dedicated **test-management** system as the single source
of truth and want automation to _reconcile_ with it, not fight it. This proposal adds a
**`TestManagementSync`** seam — a sibling to the existing Linear/Jira/GitHub-Projects requirement
sync in `@warden/integrations` — with adapters for `testomatio`, `qase`, `testrail`, `xray`,
`zephyr`, and `allure-testops`. Each adapter **pulls** the canonical spec catalog into Warden's
coverage matrix, **registers** generative-agent and coverage-sync-proposed tests back respecting the
tool's **stable IDs**, and **pushes** execution results. It is bi-directional and ID-stable;
`config.testManagement.sync.source` selects one adapter. The interface is designed once and the
**testomat.io** adapter (source-code-first) is specified in full; the rest are outlined behind the
same seam.

## Motivation

If Warden's generative agent writes tests and coverage-sync proposes changes, those artifacts must
**round-trip** with the team's system of record — IDs, statuses, requirement links, coverage —
instead of drifting from it. The gap analysis (§2.1) names the market: **testomat.io** is the closest
fit (imports tests from code — Playwright/Cypress/CodeceptJS, JS/TS or Gherkin — reads them
_source-code-first_ so a rename in code updates automatically, keeps two-way issue-tracker sync, and
maintains a BDD **Steps Database**). The same need is served by **Qase**, **TestRail**, **Xray**
(Jira-native; Warden's Requirement→Test→Execution model is already Xray-inspired), **Zephyr
Scale/Squad**, and **Allure TestOps**. Without this seam Warden is an island: it generates and heals
tests that the team's source-of-truth never sees, so coverage numbers disagree and adoption stalls.

## Goals

1. Define one **`TestManagementSync`** seam (pull catalog · upsert test · push results), a sibling to
   `IntegrationAdapter`, that any of the six systems can implement.
2. **Pull** the external catalog into Warden's coverage matrix, keyed by the tool's **stable ID**, and
   classify each entry as `matched | new-in-tool | new-in-code | changed | orphaned`.
3. **Register** generated / coverage-sync-proposed tests back — creating new IDs or updating existing
   ones — and, for source-code-first tools, carry the assigned ID **into the committed spec** so code
   and tool stay in lockstep.
4. **Push** per-test execution results, keyed by stable ID, as a Run in the external tool.
5. Fully specify the **testomat.io** adapter; outline the other five behind the same seam.
6. Be additive to `@warden/core`, reuse the existing `@warden/integrations` injection pattern
   (`FetchLike`, `requestJson`, typed `WardenError`s), and stay fully hermetic in tests.

## Non-Goals

- **Multi-source at once.** V1 syncs exactly one `source`; a repo pointing at two tools is future work.
- **Auto-deleting tests.** An orphan (in one side, not the other) is _reported_; removal is routed
  through coverage-sync's human-approved `remove` recommendation, never applied here.
- **Replacing** Warden's requirement sync (`integrations.provider`). That syncs _requirements_; this
  syncs _tests/specs/results_. They compose.
- **Bespoke BDD authoring UIs.** Warden reads/writes the tool's steps; it doesn't reimplement them.

## Architecture

Additive extensions to two existing packages — **no new package**, matching §2.1's "sibling in
`@warden/integrations`" framing.

### Extended (additive, no breaking changes)

- **`@warden/core`** — a new contract file `test-management-sync.ts` (exported from `index.ts`) with
  the `TestManagementSync` interface and its data types. Purely additive; existing schemas untouched.
- **`@warden/integrations`** — a new `tms/` family beside the requirement-sync adapters, reusing the
  same `FetchLike`/`requestJson`/`defaultFetch` seam and the typed-error convention.
- **`@warden/core` config** — an additive `testManagement.sync` block on `WardenConfigSchema`.

### The seam (in `@warden/core`, additive)

```ts
import type { Artifact, Priority, TestCase, TestStatus } from './schema';

/** Which external test-management system is the source of truth. */
export type TmsSource = 'testomatio' | 'qase' | 'testrail' | 'xray' | 'zephyr' | 'allure-testops';

/** Where a source-code-first tool maps a spec back to code. */
export interface SourceCodeRef {
  filePath: string;
  testName: string;
  framework: 'playwright' | 'cypress' | 'codeceptjs' | 'gherkin';
}

/** A canonical spec pulled from the external system. `externalId` is STABLE and owned by the tool. */
export interface SpecCatalogEntry {
  externalId: string; // testomat.io @T…, Qase case id, TestRail C###, Xray/Zephyr key, Allure AS id
  title: string;
  tags: string[];
  requirementIds: string[]; // linked issues/requirements in the tool (e.g. Jira keys)
  priority?: Priority;
  automation: 'automated' | 'manual';
  bddSteps?: string[]; // present when the tool maintains a Gherkin Steps Database (testomat.io)
  sourceRef?: SourceCodeRef; // present for source-code-first tools
}

/** A test Warden wants to create or update in the external system. */
export interface TmsTestUpsert {
  externalId?: string; // present ⇒ update; absent ⇒ create (tool mints the stable id)
  title: string;
  tags: string[];
  requirementIds: string[];
  priority: Priority;
  source: TestCase['source']; // 'manual' | 'ai-generated' | 'recorded'
  sourceRef?: SourceCodeRef; // the generated/proposed spec's file + test name
  bddSteps?: string[];
}

/** The stable handle the tool returns after an upsert. */
export interface TmsTestRef {
  externalId: string;
  url?: string;
}

/** One per-test outcome, keyed by stable id, pushed back as part of a Run. */
export interface TmsResultPush {
  externalId: string;
  status: TestStatus; // reuses core PASS | FAIL | SKIP | BLOCKED | FLAKY
  durationMs: number;
  errorMessage?: string;
  artifacts?: Artifact[];
}

export interface TmsRunMeta {
  runRef: string; // PR number, commit SHA, or execution id
  environment: string;
  startedAt: Date;
  completedAt?: Date;
}

/** Bi-directional, ID-stable sync with an external test-management system. */
export interface TestManagementSync {
  readonly source: TmsSource;
  /** True when the tool reads tests source-code-first (a rename in code updates the tool). */
  readonly sourceCodeFirst: boolean;
  /** Pull the canonical spec catalog — the tool owns the ids. */
  pullCatalog(): Promise<SpecCatalogEntry[]>;
  /** Create or update one test, respecting the tool's stable ids. Idempotent by `externalId`. */
  upsertTest(test: TmsTestUpsert): Promise<TmsTestRef>;
  /** Push results as a Run, keyed by stable id. */
  pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void>;
}
```

`SpecCatalogEntry`, `TmsResultPush`, and `TmsTestUpsert` deliberately reuse core `Priority`,
`TestStatus`, `Artifact`, and `TestCase['source']`, so the seam speaks Warden's existing vocabulary
and nothing new leaks into the domain model.

### Stable IDs live in-band

No `TestCaseSchema` change: the external stable ID is carried as a **tag** on the local test
(`@T1a2b3c4d` for testomat.io, `@Qase-42`, `@C123`, `@CALC-1234`, `@ZE-5`, `@AS-9`). The
`id-convention` unit parses and injects these per-source, so the round-trip is ID-stable in code and
the `automation.testName`/`filePath` on a generated spec become the `SourceCodeRef`.

## Configuration

Additive `testManagement.sync` block (defaults keep every existing config valid):

```ts
testManagement: {
  // …existing fields (requirementsSource, testCasesDir, generatedTestsDir, commitGeneratedTests)…
  sync: {
    source: 'none',            // 'none' | 'testomatio' | 'qase' | 'testrail' | 'xray' | 'zephyr' | 'allure-testops'
    project: undefined,        // project id/key/prefix in the external tool
    apiUrl: undefined,         // override the tool's default endpoint (self-hosted TestRail/Allure/Zephyr)
    pullCatalog: true,         // fold the external catalog into the coverage matrix
    registerProposed: true,    // upsert generated + coverage-sync-proposed tests back
    pushResults: true,         // push a Run of results after execution
    sourceCodeFirst: true,     // testomat.io: write the assigned id back into the committed spec
  },
}
```

As a Zod fragment on `WardenConfigSchema.testManagement`:

```ts
sync: z
  .object({
    source: z
      .enum(['none', 'testomatio', 'qase', 'testrail', 'xray', 'zephyr', 'allure-testops'])
      .default('none'),
    project: z.string().optional(),
    apiUrl: z.string().optional(),
    pullCatalog: z.boolean().default(true),
    registerProposed: z.boolean().default(true),
    pushResults: z.boolean().default(true),
    sourceCodeFirst: z.boolean().default(true),
  })
  .default({}),
```

Secrets (API keys / bearer tokens) come from the environment and are injected into the factory —
never read from the config file — exactly as the existing requirement-sync adapters do. Setting
`registerProposed: false` / `pushResults: false` enables **pull-only** adoption; `source: 'none'`
is a clean no-op.

## Data flow

1. A PR/CI trigger fires; the CLI calls `createTestManagementSync(cfg, deps)`. `source: 'none'` →
   `null` → the whole feature is skipped (mirrors `createIntegration`).
2. `pullCatalog()` fetches the canonical catalog from the tool → `SpecCatalogEntry[]` (stable ids,
   links, and `sourceRef` for source-code-first tools).
3. `catalog-merge` reconciles the catalog against Warden's local `TestCase[]` (yaml-cases +
   generated dir) by stable-id tag → `matched | new-in-tool | new-in-code | changed | orphaned`, and
   folds the tool's `requirementIds` into `computeCoverage` so the matrix reflects the source of truth.
4. The orchestrator computes the change surface; the generative agent + coverage-sync propose new /
   updated specs for the diff.
5. If `registerProposed`, `register` calls `upsertTest()` for each proposal → a `TmsTestRef`;
   `id-convention` injects the stable id as a tag. For source-code-first tools this id lands in the
   **committed** spec, so tool and code stay in lockstep (`new-in-code` becomes `matched`).
6. The runner executes the selected tier; the Playwright→CTRF converter yields `TestResult[]`.
7. If `pushResults`, results are mapped to `TmsResultPush[]` (by stable-id tag) and `pushResults()`
   posts a **Run** to the external tool with `TmsRunMeta` (PR/commit ref, environment, timing).
8. The merge gate's BLOCK/WARN/PASS verdict now accounts for externally-owned specs (via the updated
   coverage matrix), and the reporter/dashboard render each row with its external id + deep link.

## Units & files

| File                                             | Responsibility                                                                                                                                                                                                      | Deps                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `packages/core/src/test-management-sync.ts`      | The `TestManagementSync` seam + `SpecCatalogEntry` / `TmsTestUpsert` / `TmsTestRef` / `TmsResultPush` / `TmsRunMeta` / `TmsSource` types (additive, exported from `index.ts`).                                      | core schema types           |
| `integrations/src/tms/create-tms.ts`             | `createTestManagementSync(cfg, deps): TestManagementSync \| null` — selects the adapter by `cfg.testManagement.sync.source`; throws typed `WardenError` on missing token/project (mirrors `create-integration.ts`). | core, adapters              |
| `integrations/src/tms/id-convention.ts`          | Per-source parse/inject of the stable-id tag (`@T…`, `@Qase-…`, `@C…`, `@<KEY>`, `@ZE-…`, `@AS-…`); maps a `TestCase` ⇄ `externalId` + `SourceCodeRef`.                                                             | core                        |
| `integrations/src/tms/catalog-merge.ts`          | `(SpecCatalogEntry[], TestCase[]) → CatalogReconciliation` — classify matched/new/changed/orphaned; fold `requirementIds` into the coverage matrix.                                                                 | core, test-management types |
| `integrations/src/tms/result-status.ts`          | Map core `TestStatus` → each tool's result vocabulary (e.g. PASS→`passed`, FAIL→`failed`, FLAKY→`passed`+flaky flag / `blocked`).                                                                                   | core                        |
| `integrations/src/tms/testomatio-adapter.ts`     | **Full** source-code-first adapter (pull/upsert/pushResults + reporter Run).                                                                                                                                        | core, fetch-like            |
| `integrations/src/tms/qase-adapter.ts`           | Qase adapter (outline: `/v1` cases + bulk results).                                                                                                                                                                 | core, fetch-like            |
| `integrations/src/tms/testrail-adapter.ts`       | TestRail adapter (outline: `api/v2` cases + `add_results_for_cases`).                                                                                                                                               | core, fetch-like            |
| `integrations/src/tms/xray-adapter.ts`           | Xray adapter (outline: authenticate → `import/execution`; keys align with the Xray-inspired model).                                                                                                                 | core, fetch-like            |
| `integrations/src/tms/zephyr-adapter.ts`         | Zephyr Scale adapter (outline: `/v2/testcases` + `/testexecutions`).                                                                                                                                                | core, fetch-like            |
| `integrations/src/tms/allure-testops-adapter.ts` | Allure TestOps adapter (outline: test-cases + launches).                                                                                                                                                            | core, fetch-like            |
| `integrations/src/index.ts`                      | Re-export the `tms/` surface (additive).                                                                                                                                                                            | —                           |

Each adapter takes `{ token, project, apiUrl?, fetchImpl? }` and defaults `fetchImpl` to
`defaultFetch()`, so unit tests inject a fake `FetchLike` and never touch a live tool.

## The testomat.io adapter (specified in full)

Source-code-first: testomat.io imports automated tests from code, assigns each a `@T<hash>` id, and
expects that id to be written back into the source. The adapter models that round-trip.

```ts
export interface TestomatioAdapterOptions {
  token: string; // testomat.io API key, sent as `X-Api-Key`
  project: string; // project id/prefix
  apiUrl?: string; // defaults to https://app.testomat.io
  fetchImpl?: FetchLike; // injected; defaults to global fetch
}

export class TestomatioAdapter implements TestManagementSync {
  readonly source = 'testomatio' as const;
  readonly sourceCodeFirst = true;

  async pullCatalog(): Promise<SpecCatalogEntry[]> {
    // GET {apiUrl}/api/test_data?api_key={token} — tests with @T ids, suites/tags,
    // linked issues, and (for automated) file + test name → SpecCatalogEntry[] with
    // sourceRef populated. requestJson throws TMS_TESTOMATIO_REQUEST_FAILED on non-2xx.
  }

  async upsertTest(test: TmsTestUpsert): Promise<TmsTestRef> {
    // No externalId → POST /api/tests (mint a @T id from title + sourceRef);
    // externalId present → PATCH /api/tests/{id} (title/tags/links only — id is stable).
    // The caller's id-convention writes the returned @T id into the committed spec.
  }

  async pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void> {
    // POST /api/reporter?api_key={token} with a run title (meta.runRef) and per-test
    // { rid: externalId, status, message: errorMessage, run_time: durationMs } — creates a Run.
  }
}
```

**Round-trip guarantees.** `pullCatalog` reports `sourceCodeFirst: true`, so a rename in code (new
`testName`) is a _metadata update_ keyed by the stable `@T` id, not a new test. `upsertTest` never
mints a second id for a test that already carries one. `pushResults` is keyed strictly by
`externalId`, so results attach to the right canonical spec regardless of file moves.

## The other five (outlined behind the same seam)

- **Xray** (`xray-adapter.ts`) — Jira-native; `sourceCodeFirst: false`. `pullCatalog` reads test
  issues (keys like `CALC-1234`) and their requirement links (which map directly onto Warden's
  Xray-inspired Requirement→Test model); `pushResults` authenticates, then POSTs an execution import.
  Highest fidelity after testomat.io because the data models already align.
- **Qase** (`qase-adapter.ts`) — `Token` header; `pullCatalog` reads cases under the project,
  `upsertTest` creates/updates cases, `pushResults` bulk-posts results into a run. Stable id = case id.
- **TestRail** (`testrail-adapter.ts`) — basic auth; `get_cases` → catalog, `add_results_for_cases`
  → run results. Stable id = `C<case_id>`. Self-hosted URL via `apiUrl`.
- **Zephyr Scale** (`zephyr-adapter.ts`) — bearer token; `/testcases` → catalog, `/testexecutions`
  → results. Stable id = test-case key.
- **Allure TestOps** (`allure-testops-adapter.ts`) — bearer token; test-cases → catalog, launches →
  results. Stable id = the `AS`/allure id. Self-hosted URL via `apiUrl`.

Each starts as **pull + push-results** (read-only-ish, safe to adopt), and gains `upsertTest`
fidelity as the tool's write API allows — the seam is identical, so the CLI wiring never changes.

## Safety & error handling

- **`source: 'none'` / nothing configured** → factory returns `null`; the sync step is skipped with a
  neutral note. No accidental writes.
- **Missing token / project** → typed `WardenError` (`TMS_MISSING_TOKEN`, `TMS_MISSING_CONFIG`) at
  construction, exactly like `createIntegration`.
- **ID stability first** → `upsertTest` is idempotent by `externalId`; re-running the same PR never
  duplicates a test. The stable-id tag in code is the join key everywhere.
- **Orphans are reported, never deleted** → catalog-merge surfaces `orphaned` entries; deletion is a
  coverage-sync `remove` recommendation for a human, consistent with that proposal's "removals are
  proposed, never applied" rule.
- **Partial failures don't abort the run** → per-item pull/upsert/push errors are collected and
  surfaced in the summary; local CTRF results are always written even if a push fails.
- **Bounded** → bulk result pushes are chunked; oversized catalogs are paged. Whatever is skipped is
  stated, never silently truncated.
- **Least privilege / secrets** → tokens come from env and are scoped to the one selected tool.
- **Conflict handling** → when the external tool's requirement links disagree with Warden's
  `requirementsSource`, the external system of record wins for coverage, and the conflict is flagged.

## Testing

Fully hermetic, matching the rest of `@warden/integrations`:

- **Injected collaborators:** a fake `FetchLike` per adapter (no live tool), `fakeProvider` from
  `@warden/core/testing` for the generative/register integration test, and in-memory `TestCase[]`
  fixtures for catalog-merge. No network, no real tool, no LLM in unit tests.
- **`testomatio-adapter`:** fake fetch returns catalog JSON → asserts `SpecCatalogEntry[]` with
  `sourceRef` + `sourceCodeFirst === true`; asserts the `upsertTest` POST/PATCH payload and returned
  `@T` id; asserts the `pushResults` reporter payload (endpoint, `rid`, status mapping
  PASS→`passed`/FAIL→`failed`/FLAKY handling, `run_time`).
- **`catalog-merge`:** (catalog + local cases) fixtures → expected `matched / new-in-tool /
new-in-code / changed / orphaned` classification and the recomputed coverage matrix.
- **`id-convention`:** parse ⇄ inject round-trip for all six tag formats (idempotent — injecting an
  existing id is a no-op).
- **`result-status`:** every core `TestStatus` maps to each tool's vocabulary.
- **`create-tms`:** config → correct adapter / `null` / typed error, mirroring
  `create-integration.test.ts`.
- **End-to-end (hermetic):** pull → merge → upsert (with `fakeProvider`-authored spec) → push, all
  collaborators faked, asserting the stable id is written into the spec and results attach to it.

## Rollout

1. Land the additive `@warden/core` seam + types + the `testManagement.sync` config block (no
   adapters) — hermetically testable on its own.
2. Build the `tms/` skeleton (`create-tms`, `id-convention`, `catalog-merge`, `result-status`,
   `register`) + the **full testomat.io adapter**. Wire the CLI: pull → merge → register → run →
   push.
3. Add **Xray** next (best model alignment), then **Qase**, **TestRail**, **Zephyr**, **Allure
   TestOps** as per-adapter increments behind the unchanged seam.
4. Surface external ids + deep links in the reporter (PR comment) and the dashboard coverage matrix;
   document `testManagement.sync` in `docs/configuration.md`.

## Risks & open items

- **Write-API disparity.** Only testomat.io is truly source-code-first; the others are
  case-management-first with varying upsert fidelity. The seam abstracts read/upsert/push, but the
  first cut of Xray/Qase/TestRail/Zephyr/Allure ships pull + push-results, adding upsert as APIs allow.
- **Stable-ID collisions across tools.** V1 syncs one `source`; a repo pointed at two systems would
  need namespaced tags — deferred.
- **Requirement-link reconciliation.** When the external tool and `requirementsSource` disagree, we
  prefer the external source of truth for coverage but must flag conflicts rather than silently pick.
- **Bi-directional deletes** are intentionally out of scope here — routed through coverage-sync's
  human-approved `remove` path.
- **Choice of default source.** §2.1's open follow-up ("confirm testomat.io vs Xray/Qase") applies:
  the seam is neutral, but the fully specified first adapter assumes testomat.io.
