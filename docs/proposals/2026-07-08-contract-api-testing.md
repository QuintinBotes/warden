# Proposal: API & Contract Testing (Schemathesis + Pact)

- Status: Draft (design proposal) · Date: 2026-07-08 · Relates to: warden-next-competitive-gaps.md §1.6

## Summary

This proposal adds an `api` test tier to `@warden/runner`: OpenAPI property-based fuzzing via
Schemathesis, and consumer-driven contract verification via a Pact Broker adapter, each converted
to CTRF the same way the existing k6 and ZAP tiers are. Provider-side contract failures don't just
fail the tier — they're correlated against the cross-repo `links.dependents` a repo already
declares, so a provider PR that breaks a consumer's contract shows up as a named, low/high-confidence
"who will break" advisory in the coverage-sync check, not just an abstract test failure.

## Motivation

In a microservice org, contract drift between services is the top integration risk: a provider
changes a response shape or a status code, its own tests stay green, and a consumer breaks in
production days later. §1.6 of the gap analysis names the incumbents that own this space —
**Pact** (consumer-driven contracts, with a broker that tracks who-verified-what and gates
deploys via "can-i-deploy"), **Schemathesis** (OpenAPI property-based fuzzing that finds
500s/schema violations no example-based test would think to try), and **Postman/Newman** /
**Karate** for scripted API assertions. Warden already has the cross-repo primitive that makes
this interesting — `links.dependents` (packages/core/src/coverage-sync.ts) declares which repos
consume a service — but nothing today runs an API/contract tier or feeds a contract break into
that list. This proposal closes both: it gives Warden the table-stakes API-testing depth Pact and
Schemathesis represent, and it's the first tier whose failures are cross-repo aware out of the box.

## Goals

1. An `api` test tier, selected by the orchestrator alongside the existing four, that runs when a
   PR touches API routes and `config.api` is enabled.
2. Schemathesis-style OpenAPI fuzzing: point it at a running preview build's schema, convert its
   findings to CTRF, gate on server errors and schema/status-code conformance.
3. A Pact Broker adapter: when this repo is a contract **provider**, fetch the consumer contracts
   published against it, verify each interaction against the running preview build, publish
   verification results (and a `canIDeploy` check) back to the broker.
4. Both feed the **same merge gate** every other tier feeds — no bespoke gate logic, just CTRF
   tests with the right status.
5. Provider-side contract failures are correlated against `links.dependents` (and an explicit
   Pact-consumer → repo map) and surfaced as advisories in the existing coverage-sync check-run,
   so "which consumer repo breaks" is visible next to the usual test/doc suggestions.
6. Fully hermetic: Schemathesis and the broker are shelled-out/HTTP collaborators behind injected
   seams; every converter and gate rule is a pure function unit-tested with fixtures.

## Non-Goals

- Generating consumer-side Pact tests (writing the interactions consumers assert against) — this
  proposal verifies the **provider** side against contracts consumers have already published.
  Consumer-side pact authoring is future work, likely as a generative-agent extension.
- GraphQL contract testing (schema diffing for GraphQL is a different shape of problem).
- Running a Pact Broker or Schemathesis itself — both are external services/binaries Warden talks
  to via injected clients, same posture as the ZAP/k6 tiers (`zap-baseline.py`, the `k6` binary).
- Automatically inferring `links.dependents` from Pact Broker data. First version reads the
  broker's consumer names and maps them to repos via an explicit, declared config map; using the
  broker itself as the source of truth for dependents is a natural follow-up (see Risks).

## Architecture

One new subsystem inside the existing `@warden/runner` (mirroring `runner/src/perf/k6.ts` and
`runner/src/security/zap.ts`), a small additive extension to `@warden/orchestrator`'s tier
selection, additive types in `@warden/core`, and a new pure unit in `@warden/coverage-sync`.

### `@warden/core` (additive)

New file `packages/core/src/api-contracts.ts`, re-exported from `src/index.ts`:

```ts
// Schemathesis — the subset of its report shape Warden consumes.
export interface SchemathesisCheckFailure {
  checkName:
    'not_a_server_error' | 'response_schema_conformance' | 'status_code_conformance' | string;
  message: string;
  example?: Record<string, unknown>;
  seed?: string;
}

export interface SchemathesisEndpointResult {
  method: string; // 'GET' | 'POST' | ...
  path: string; // '/orders/{id}'
  checksRun: number;
  failures: SchemathesisCheckFailure[];
}

export interface SchemathesisReport {
  schemaUrl: string;
  endpoints: SchemathesisEndpointResult[];
}

// Pact — the subset of broker/verification shapes Warden consumes.
export interface PactRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface PactResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface PactInteraction {
  description: string;
  providerState?: string;
  request: PactRequest;
  response: PactResponse; // the expected response
}

export interface PactContract {
  consumer: string;
  provider: string;
  pactUrl: string;
  interactions: PactInteraction[];
}

export interface ContractMismatch {
  path: string; // JSON-pointer-ish location, e.g. 'body.total' or 'status'
  expected: unknown;
  actual: unknown;
}

export interface ContractCheckResult {
  interaction: PactInteraction;
  success: boolean;
  mismatches: ContractMismatch[];
}

export interface ContractVerificationResult {
  consumer: string;
  provider: string;
  checks: ContractCheckResult[];
}

/** Injected access to a Pact Broker (self-hosted Pact Broker or Pactflow-compatible). */
export interface PactBrokerClient {
  fetchConsumerContracts(provider: string, tag?: string): Promise<PactContract[]>;
  publishVerificationResults(
    contract: PactContract,
    result: ContractVerificationResult,
    providerVersion: string,
  ): Promise<void>;
  canIDeploy(
    provider: string,
    providerVersion: string,
    environment: string,
  ): Promise<{ deployable: boolean; reason: string }>;
}

/** Correlates a failed contract verification to the repo that owns the consumer, for cross-repo impact. */
export interface ContractDriftAdvisory {
  consumer: string;
  dependentRepo?: string; // resolved via api.pact.consumerRepoMap, when known
  confidence: 'high' | 'low'; // high when dependentRepo is also declared in links.dependents
  failedInteractions: string[]; // interaction descriptions
  detail: string;
}
```

Additive schema change: widen `TestTier` (`packages/core/src/change-surface.ts`) from
`'smoke' | 'selective' | 'fullRegression' | 'aiExploratory'` to add `'api'`. No existing code
switches exhaustively on `TestTier` (`selectTiers` builds an array; nothing pattern-matches every
member), so this is a safe, additive widening.

### `@warden/runner` (new files)

`runner/src/api/schemathesis.ts` — same three-way split as `zap.ts`/`k6.ts`: a pure converter, a
pure gate, and unit-untested integration glue.

```ts
export function schemathesisJsonToCtrf(json: unknown): CTRFReport;

/** BLOCK on any server-error or schema/status-code conformance failure; WARN on other checks. */
export function evaluateSchemathesisGate(report: CTRFReport): GateDecision;

export interface RunSchemathesisOptions {
  cwd?: string;
  checks?: string[]; // defaults to config.api.schemathesis.checks
  maxExamples?: number;
  reportPath?: string;
  command?: string; // defaults to 'schemathesis'
  env?: Record<string, string>;
}

export interface RunSchemathesisResult {
  report: CTRFReport;
  gate: GateDecision;
}

/** Shells out to `schemathesis run <schemaUrl> ...`, reads its JSON report, converts + gates it. */
export function runSchemathesis(
  schemaUrl: string,
  opts?: RunSchemathesisOptions,
): Promise<RunSchemathesisResult>;
```

`runner/src/api/pact.ts` — the provider-verification adapter, split into a pure comparator (unit
tested with fixtures) and integration glue that needs a live provider to call.

```ts
/** Pure: compares an actual response to the interaction's expected response. No network I/O. */
export function compareResponses(expected: PactResponse, actual: PactResponse): ContractMismatch[];

/**
 * Verifies every interaction in `contracts` by sending its `request` through `invoke` (injected —
 * in CI this posts to a running preview build; in tests it's a fake returning canned responses)
 * and comparing via {@link compareResponses}. No broker or network access beyond `invoke`.
 */
export function verifyContracts(
  contracts: PactContract[],
  invoke: (req: PactRequest) => Promise<PactResponse>,
): Promise<ContractVerificationResult[]>;

export function pactVerificationToCtrf(results: ContractVerificationResult[]): CTRFReport;

/** BLOCK if any interaction failed — a broken contract is a breaking change for a live consumer. */
export function evaluatePactGate(results: ContractVerificationResult[]): GateDecision;

export interface RunPactVerificationOptions {
  providerVersion: string; // typically the PR's head SHA
  tag?: string; // broker consumer-version tag to pull contracts for, e.g. 'main'
  environment?: string; // for the post-verification canIDeploy check
  publish?: boolean; // defaults to config.api.pact.publishVerificationResults
}

export interface RunPactVerificationResult {
  contracts: PactContract[];
  results: ContractVerificationResult[];
  report: CTRFReport;
  gate: GateDecision;
  canIDeploy?: { deployable: boolean; reason: string };
}

/**
 * Integration glue: fetches this provider's consumer contracts from `broker`, verifies them
 * against `invoke`, converts + gates the results, and (if `publish`) writes verification results
 * and a `canIDeploy` check back to the broker. NOT unit-tested (needs a live broker + provider);
 * {@link compareResponses}, {@link verifyContracts} (with a fake `invoke`), and
 * {@link evaluatePactGate} are unit-tested instead.
 */
export function runPactVerification(
  providerName: string,
  broker: PactBrokerClient,
  invoke: (req: PactRequest) => Promise<PactResponse>,
  opts: RunPactVerificationOptions,
): Promise<RunPactVerificationResult>;
```

`runner/src/api/run-api-tier.ts` — composes both into the one `api` tier the orchestrator selects.

```ts
export interface ApiTierDeps {
  invoke: (req: PactRequest) => Promise<PactResponse>; // hits the running preview build
  broker?: PactBrokerClient; // required only when config.api.pact.enabled
  runSchemathesis?: typeof runSchemathesis; // injected in tests
  runPactVerification?: typeof runPactVerification; // injected in tests
}

export interface ApiTierResult {
  report: CTRFReport; // schemathesis + pact tests merged
  gate: GateDecision; // worst-of both sub-gates
  contractResults: ContractVerificationResult[]; // empty when pact is disabled
}

/** Runs whichever of Schemathesis / Pact verification `config.api` enables and merges the results. */
export function runApiTier(
  schemaUrl: string,
  providerVersion: string,
  cfg: WardenConfig,
  deps: ApiTierDeps,
): Promise<ApiTierResult>;
```

`runner/src/index.ts` gains the re-exports for all of the above, alongside the existing k6/ZAP/Appium
exports.

### `@warden/orchestrator` (additive)

`select-tiers.ts` gains one additional rule, ORed with the existing risk-based ones:

```ts
if (cfg.api.enabled && surface.affectedApiRoutes.length > 0 && !tiers.includes('api')) {
  tiers.push('api');
}
```

`affectedApiRoutes` already exists on `ChangeSurface` (populated by
`compute-change-surface.ts`/`analyze-change-surface.ts`), so no new change-surface field is needed.

### `@warden/coverage-sync` (new pure unit + additive wiring)

New file `packages/coverage-sync/src/contract-impact.ts`:

```ts
export function contractDriftImpact(
  results: ContractVerificationResult[],
  dependents: string[], // resolved links.dependents for this PR (from resolveLinks)
  consumerRepoMap: Record<string, string>, // config.api.pact.consumerRepoMap
): ContractDriftAdvisory[];
```

Pure: for each `ContractVerificationResult` with at least one failed check, looks up
`consumerRepoMap[result.consumer]`; if found, sets `dependentRepo` and marks `confidence: 'high'`
when that repo also appears in `dependents`, else `'low'` (declared-but-unmapped or
mapped-but-undeclared cases are still reported, just with lower confidence — same posture the
cross-repo proposal already takes for dependent-repo suggestions).

`coverage-sync/src/run.ts` gets two additive, optional fields — existing callers that don't pass
them are unaffected:

```ts
export interface RunCoverageSyncInput {
  // ...unchanged fields...
  contractResults?: ContractVerificationResult[]; // from ApiTierResult.contractResults
}

export interface CoverageSyncSummary {
  // ...unchanged fields...
  contractAdvisories: ContractDriftAdvisory[]; // [] when contractResults wasn't supplied
}
```

`runCoverageSync` computes `contractAdvisories` via `contractDriftImpact(input.contractResults ??
[], links.dependents, input.cfg.api.pact.consumerRepoMap)` right after `resolveLinks`, and appends
a "Cross-service impact" section to the check-run summary body (`publish`'s `summarize`/`prBody`
helpers gain one more section, still a single `postCheckRun` call — no new `GitHubAccess` method).

## Configuration

Additive `api` block on `WardenConfigSchema`, same shape/posture as the existing `performance` and
`security` blocks:

```ts
export default defineConfig({
  api: {
    enabled: true,
    schemathesis: {
      enabled: true,
      schemaUrl: 'https://preview.internal/openapi.json',
      checks: ['not_a_server_error', 'response_schema_conformance', 'status_code_conformance'],
      maxExamplesPerEndpoint: 100,
    },
    pact: {
      enabled: true,
      role: 'provider',
      providerName: 'checkout-service',
      brokerUrl: process.env.PACT_BROKER_URL,
      publishVerificationResults: true,
      // Pact consumer name -> the repo that owns it, for cross-repo drift advisories.
      consumerRepoMap: {
        'web-app': 'org/web-app',
        'mobile-app': 'org/mobile-app',
      },
    },
  },
});
```

| Key                                       | Type                       | Default                                                                            | Notes                                                                   |
| ----------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `api.enabled`                             | `boolean`                  | `false`                                                                            | Master switch for the `api` tier.                                       |
| `api.schemathesis.enabled`                | `boolean`                  | `false`                                                                            |                                                                         |
| `api.schemathesis.schemaUrl`              | `string`                   | —                                                                                  | OpenAPI schema URL of the running preview build. Required when enabled. |
| `api.schemathesis.checks`                 | `string[]`                 | `['not_a_server_error', 'response_schema_conformance', 'status_code_conformance']` |                                                                         |
| `api.schemathesis.maxExamplesPerEndpoint` | `number`                   | `100`                                                                              |                                                                         |
| `api.pact.enabled`                        | `boolean`                  | `false`                                                                            |                                                                         |
| `api.pact.role`                           | `'provider' \| 'consumer'` | `'provider'`                                                                       | First version only implements provider-side verification.               |
| `api.pact.providerName`                   | `string`                   | —                                                                                  | Required when `pact.enabled`.                                           |
| `api.pact.brokerUrl`                      | `string`                   | —                                                                                  | Required when `pact.enabled`.                                           |
| `api.pact.publishVerificationResults`     | `boolean`                  | `true`                                                                             |                                                                         |
| `api.pact.consumerRepoMap`                | `Record<string, string>`   | `{}`                                                                               | Pact consumer name → `owner/repo`, feeds `contractDriftImpact`.         |

## Data flow

1. PR opens/updates on a provider service repo; the change surface computation (`@warden/orchestrator`)
   populates `affectedApiRoutes`.
2. `selectTiers` adds `'api'` to the tier list because `config.api.enabled` is true and the diff
   touches API routes.
3. CI (the GitHub Action / CLI) deploys or already has a running preview build, and calls
   `runApiTier(schemaUrl, headSha, cfg, { invoke, broker })`.
4. If `api.schemathesis.enabled`: `runSchemathesis` fuzzes the changed schema's endpoints against
   the preview build → `SchemathesisReport` → `schemathesisJsonToCtrf` → `evaluateSchemathesisGate`.
5. If `api.pact.enabled` and `role === 'provider'`: `runPactVerification` fetches this provider's
   published consumer contracts from the broker, verifies each interaction against the same preview
   build via `invoke`, converts via `pactVerificationToCtrf`, gates via `evaluatePactGate`, and (if
   `publish`) writes verification results + a `canIDeploy` check back to the broker tagged with the
   PR's head SHA.
6. `runApiTier` merges both CTRF reports and gate decisions (worst-of) into one `ApiTierResult`.
7. The `api` tier's CTRF report merges into the run's aggregate CTRF report exactly like smoke/
   selective/fullRegression/aiExploratory (`@warden/reporter`'s `aggregate`); `ctrfToExecution` +
   `computeGateDecision`/`evaluateExitCriteria` roll any Schemathesis/Pact failure into the overall
   PASS/WARN/BLOCK the same way a failed Playwright spec would — no bespoke gate logic downstream
   of CTRF.
8. `@warden/reporter`'s PR comment / check-run annotations show the failing endpoint or interaction
   by name, same as any other failing test, with the mismatch detail from `extra`.
9. In parallel, `@warden/coverage-sync`'s `runCoverageSync` (already running for this PR because
   `links` is configured) is handed `ApiTierResult.contractResults`; `contractDriftImpact` correlates
   any failed verification against `links.dependents` + `api.pact.consumerRepoMap` and appends a
   "Cross-service impact" section — naming the consumer, the failed interactions, and (when known)
   the dependent repo that owns it — to the same check-run coverage-sync already posts.
10. `@warden/test-management`'s `SqliteStore.saveExecution` persists the merged execution (via the
    normal `ctrfToExecution` path) tagged `api`/`schemathesis`/`pact`, so contract/API results show
    up in the existing coverage matrix and flake-history views with no new persistence code.

## Units & files

| File                                            | Responsibility                                                                                                             | Deps                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `packages/core/src/api-contracts.ts`            | Schemathesis/Pact/contract-advisory types, `PactBrokerClient` interface.                                                   | none (types only)                    |
| `packages/core/src/change-surface.ts`           | Widen `TestTier` to include `'api'`.                                                                                       | —                                    |
| `packages/core/src/config.ts`                   | Additive `api` block on `WardenConfigSchema`.                                                                              | zod                                  |
| `packages/runner/src/api/schemathesis.ts`       | Pure JSON→CTRF converter, pure gate, integration glue that shells out to `schemathesis`.                                   | core                                 |
| `packages/runner/src/api/pact.ts`               | Pure response comparator, pure `verifyContracts`/CTRF converter/gate, integration glue that talks to a `PactBrokerClient`. | core                                 |
| `packages/runner/src/api/run-api-tier.ts`       | Composes Schemathesis + Pact into the one `api` tier result.                                                               | schemathesis.ts, pact.ts, core       |
| `packages/orchestrator/src/select-tiers.ts`     | One additive rule: `affectedApiRoutes` + `config.api.enabled` → include `'api'`.                                           | core                                 |
| `packages/coverage-sync/src/contract-impact.ts` | Pure: verification failures + `dependents` + `consumerRepoMap` → `ContractDriftAdvisory[]`.                                | core                                 |
| `packages/coverage-sync/src/run.ts`             | Additive `contractResults` input / `contractAdvisories` output; calls `contractDriftImpact`.                               | contract-impact.ts, link-resolver.ts |
| `packages/coverage-sync/src/publisher.ts`       | Additive "Cross-service impact" section in the check-run summary body.                                                     | core                                 |

## Safety & error handling

- **No provider/broker access at unit-test time.** `runSchemathesis` and `runPactVerification` are
  the only I/O boundaries (spawn a binary; call a broker), matching `runZapBaseline`/`runK6`'s
  "integration glue is not unit-tested, its pure pieces are" split.
- **`invoke` failures don't crash the tier.** A network error calling the preview build during
  verification is caught per-interaction and recorded as a failed `ContractCheckResult` with the
  error message as the mismatch detail, not thrown — one unreachable endpoint fails that
  interaction, not the whole run.
- **Missing broker/schema config is a config error, not a silent skip.** If `api.pact.enabled` is
  true but `brokerUrl`/`providerName` is missing, `runApiTier` throws a `ConfigError` before
  attempting any network call (fail fast, same posture as `runReport`'s missing-octokit check).
- **Bounded fuzzing.** `maxExamplesPerEndpoint` caps Schemathesis's generated-example budget so a
  large schema can't blow the tier's time budget; endpoints beyond the cap are still fuzzed to the
  cap, not skipped.
- **Publishing is best-effort and separable.** `publishVerificationResults`/`canIDeploy` failures
  (broker unreachable, auth) are logged and surfaced as a `WARN`-level note in the tier result, not
  a `BLOCK` — a broken broker shouldn't block a merge whose actual contract checks passed.
- **Low-confidence advisories are labeled, never silently escalated.** An unmapped consumer name
  produces an advisory with `dependentRepo: undefined, confidence: 'low'` rather than being dropped
  — same "declared links + heuristics, clearly labeled" posture the cross-repo proposal takes for
  dependent-repo suggestions.

## Testing

Fully hermetic, following the `zap.ts`/`k6.ts` precedent already in `@warden/runner`:

- `schemathesisJsonToCtrf`: fixed `SchemathesisReport` fixtures (clean schema, one server-error
  endpoint, one schema-conformance failure) → asserted CTRF `passed`/`failed` counts and per-test
  `extra.failures`.
- `evaluateSchemathesisGate`: BLOCK on a `not_a_server_error`/`response_schema_conformance`
  failure, WARN on any other check failure, PASS on a clean report.
- `compareResponses`: fixture pairs (matching, status mismatch, missing header, body field
  mismatch) → exact `ContractMismatch[]`.
- `verifyContracts`: a fixed `PactContract[]` + a fake `invoke` returning canned responses per
  request → asserted `ContractVerificationResult[]`, including the case where `invoke` throws.
- `evaluatePactGate`: BLOCK when any check failed, PASS when every interaction matched.
- `runApiTier`: fake `runSchemathesis`/`runPactVerification` injected via `ApiTierDeps` → asserted
  merged CTRF `tests` length and worst-of gate (e.g. schemathesis PASS + pact BLOCK → `BLOCK`).
- `selectTiers`: a change surface with non-empty `affectedApiRoutes` + `cfg.api.enabled = true` →
  `'api'` present in the returned tiers; absent when either condition is false.
- `contractDriftImpact`: fixtures covering mapped+declared (`confidence: 'high'`),
  mapped-but-undeclared and declared-but-unmapped (`confidence: 'low'`), and the empty-results
  no-op case.
- `runCoverageSync`: existing hermetic fixture harness, extended with a `contractResults` fixture
  containing one failure → asserts `contractAdvisories` is populated and the posted check-run
  summary body contains the "Cross-service impact" section.

## Rollout

1. Ship `api-contracts.ts` in `@warden/core`, the `TestTier`/`WardenConfigSchema` widenings, and
   `runner/src/api/schemathesis.ts` (pure pieces + integration glue) with its unit tests. Usable
   standalone (Schemathesis only, no Pact) behind `api.schemathesis.enabled`.
2. Add `runner/src/api/pact.ts` + `run-api-tier.ts`, wire `selectTiers`. Dogfood against a
   self-hosted Pact Broker with two fixture services (one provider, one consumer).
3. Add `contract-impact.ts` and the `run.ts`/`publisher.ts` wiring in `@warden/coverage-sync`;
   confirm a deliberately breaking provider PR produces both a `BLOCK` gate and a labeled
   cross-service advisory naming the consumer repo.
4. Document `api.*` config and the Pact Broker setup steps in `docs/configuration.md` and a new
   `docs/api-contract-testing.md`.

## Risks & open items

- **`consumerRepoMap` is a manually maintained mapping.** Pact consumer names and repo slugs drift
  independently; a stale map produces `confidence: 'low'` advisories instead of failing loudly.
  A follow-up could resolve consumer→repo automatically from the broker's own metadata (many
  brokers let you tag a consumer with its repo URL) instead of a hand-maintained config map.
  Confirm whether the target broker's API exposes that before committing to the current shape.
- **Requires a running preview build.** Both Schemathesis and Pact verification need a live
  instance of the PR's build to call — this tier is not viable on repos without a preview/staging
  environment step already in CI; it's opt-in via `api.enabled` for exactly that reason.
  Non-GitHub SCM (§2.4) or multi-broker (Pactflow vs. self-hosted Pact Broker) support is future
  work; the `PactBrokerClient` interface is intentionally the only broker-shaped seam so a second
  implementation is additive, not a rewrite.
- **GraphQL and gRPC contracts are out of scope for v1.** Only REST/OpenAPI + Pact's HTTP
  interaction model are covered; teams on GraphQL federation would need a different verifier
  behind the same `PactBrokerClient`-shaped seam.
