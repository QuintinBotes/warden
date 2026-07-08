# Proposal: Production-Traffic Recording

- **Status:** Draft (design proposal) · **Date:** 2026-07-08 · **Relates to:** warden-next-competitive-gaps.md §2.5 (also feeds §2.2 CUJ modeling, §2.6 enterprise readiness)

## Summary

Warden's session recorder is manual and dev-driven: a human opens a browser, clicks through a flow,
and `@warden/recorder` synthesizes a spec. This proposal adds an **opt-in production-traffic
recorder** — a new `@warden/traffic` package that captures real user sessions (via an opt-in browser
SDK or a reverse-proxy tap), **scrubs PII at ingestion**, clusters the sessions into candidate
journeys, and hands the high-value clusters to the existing generative synthesizer
(`AiTestSynthesizer`) to propose tagged Playwright specs — and, alongside them, **candidate Critical
User Journeys** that feed §2.2. The suite grows from what users actually do instead of only what a
developer thought to record. Capture is strictly opt-in, PII scrubbing is mandatory and fail-closed,
and nothing is ever auto-merged: specs and CUJ proposals land as a **draft PR** for a human to review.

## Motivation

The strongest capability Warden lacks here is what **Meticulous** ships: it records real
user/production sessions and auto-generates a regression suite that catches visual and functional
drift with **zero hand-written tests**. The same "learn the suite from real usage" posture shows up
around traffic-replay and session-replay tooling generally. Warden already has every downstream piece
— a `RecordedSession` model, a deterministic `TestSynthesizer` that renders role-based Playwright
specs, and a cross-repo draft-PR publisher — but it can only be _fed by hand_. Wiring a
production-traffic feeder onto those seams turns "a developer recorded this once" into "the top twenty
real journeys are always covered, and new ones show up as PRs." It is also the most natural feeder for
**CUJ modeling (§2.2)**: the clusters _are_ the critical journeys, ranked by real frequency.

The blocker has never been the synthesis — it is doing this **safely**. Production traffic is PII by
default, so the design leads with consent, scrubbing, retention, and a documented data-handling
posture (a prerequisite already called out by §2.6), and keeps the whole capture path opt-in.

## Goals

1. Capture real sessions **only** with explicit end-user opt-in, sampled, via an injectable
   `TrafficSource` (browser SDK or reverse-proxy tap), producing the existing `RecordedSession` shape.
2. **Scrub PII before anything durable is written** — a mandatory, fail-closed `PiiScrubber` with an
   allowlist model and a documented retention/TTL policy.
3. Cluster scrubbed sessions into ranked candidate journeys deterministically (frequency × business
   weight), with no LLM in the grouping step.
4. Reuse the **existing** `AiTestSynthesizer` to turn each high-value cluster into a tagged Playwright
   spec, and propose a `CandidateCUJ` per cluster for §2.2.
5. Deliver specs + CUJ proposals as a **draft PR** (reusing the coverage-sync `GitHubAccess`
   publisher) and emit metrics via the existing `MetricsEmitter`. Never auto-merge.
6. Keep the engine fully hermetic: every collaborator (source, store, scrubber, provider, publisher)
   is injected, so the pipeline is unit-testable with no live traffic, browser, network, or LLM.

## Non-Goals

- Capturing **without** consent, or capturing raw DOM/screenshots by default (role-oriented
  interaction descriptors only — the same low-data shape the recorder's capture script already emits).
- Replacing the manual `@warden/recorder`; this is additive and complementary.
- Shipping the CUJ _entity, board, and gating_ — that is §2.2. This proposal produces `CandidateCUJ`
  proposals against a minimal additive type and stops there.
- Visual-diff replay of captured traffic (that composes with §1.1 `@warden/visual`, later).
- A managed multi-tenant collector SaaS. A self-hostable collector ships in `deploy/`; the enterprise
  auth/tenancy story is §2.6.

## Architecture

One new package plus small, additive `@warden/core` types and config. No existing signature changes;
the synthesizer and publisher are **reused as-is**.

### New

- **`@warden/traffic`** — the ingestion → scrub → cluster → synthesize → propose pipeline, built as
  small single-purpose units (below). It owns **no** network or browser dependency of its own: the
  traffic source, the durable store, the scrubber, the provider, and the GitHub publisher are all
  injected. The shipped `browserSdkSource` / `reverseProxySource` and a self-hostable collector are
  the only pieces that touch the outside world, and they live behind the `TrafficSource` seam.

### Reused unchanged

- **`@warden/recorder`** — `AiTestSynthesizer` already takes a `RecordedSession` + `LLMProvider` and
  returns tagged `GeneratedTest[]` with role-based locators and overlap-deduping. A representative
  session per cluster flows straight into it; no change required.
- **`@warden/coverage-sync`** — its `GitHubAccess` seam (`openOrUpdateDraftPr`) and draft-PR
  idempotency are reused to publish the synthesized specs.
- **`@warden/observability`** — `MetricsEmitter` records ingest/scrub/cluster/propose counts.

### Additive `@warden/core` types (`packages/core/src/traffic.ts`)

```ts
import type { RecordedSession, GeneratedTest } from './v2';
import type { LLMProvider } from './llm';
import type { WardenConfig } from './config';

/** A raw production capture before scrubbing. Normalizes to `RecordedSession` once scrubbed. */
export interface RawTrafficSession extends RecordedSession {
  /** Opaque, non-reversible session id (never a user id). */
  anonId: string;
  /** Consent signal the capture was gated on; capture MUST NOT occur without it. */
  consent: { granted: true; source: 'cookie' | 'config' | 'header' };
  /** Route path template the session started on, e.g. `/checkout/:id`. */
  routeTemplate?: string;
}

/** The ingestion seam — sibling to the recorder's `RecordingSource`, for production capture. */
export interface TrafficSource {
  /** Yields consenting, sampled raw sessions. Bounded by `opts.max`. */
  collect(opts: { max: number }): Promise<RawTrafficSession[]>;
}

/** A single redaction rule: a name, a matcher, and whether it targets keys or values. */
export interface PiiRule {
  name: string; // e.g. 'email', 'pan', 'jwt'
  pattern: RegExp;
  applyTo: 'value' | 'selectorName' | 'url';
}

/**
 * Mandatory, fail-closed PII scrub. Given a raw session, returns a clean `RecordedSession`:
 * step values / URLs / selector names matching a rule are replaced with the redaction token;
 * only fields on the allowlist pass through unredacted. On any rule error, the value is fully
 * redacted rather than leaked. Deterministic — unit-testable without external state.
 */
export interface PiiScrubber {
  scrub(session: RawTrafficSession): RecordedSession;
}

/** A candidate journey: sessions sharing a canonical step signature, ranked by real usage. */
export interface JourneyCluster {
  signature: string; // canonical route/step sequence
  routeTemplate?: string;
  frequency: number; // number of scrubbed sessions in the cluster
  weight: number; // frequency × configured business weight
  /** A representative scrubbed session, chosen deterministically (the median-length member). */
  representative: RecordedSession;
}

/** Groups scrubbed sessions into ranked candidate journeys. No LLM. */
export interface JourneyClusterer {
  cluster(sessions: RecordedSession[]): JourneyCluster[];
}

/**
 * A proposed Critical User Journey derived from a cluster. Deliberately minimal and additive:
 * §2.2 owns the full `CUJ` entity/board/gating; this is the feeder shape it consumes.
 */
export interface CandidateCUJ {
  name: string; // LLM-named, e.g. 'Guest checkout with saved card'
  signature: string;
  frequency: number;
  routeTemplate?: string;
  /** Paths of the specs synthesized for this cluster (traceability into the suite). */
  testPaths: string[];
}

export interface CujProposer {
  propose(
    cluster: JourneyCluster,
    tests: GeneratedTest[],
    provider: LLMProvider,
  ): Promise<CandidateCUJ>;
}

/** Durable store for scrubbed sessions + retention. Injected; fs/SQLite/object-store behind it. */
export interface TrafficStore {
  put(session: RecordedSession): Promise<void>;
  list(): Promise<RecordedSession[]>;
  /** Delete sessions older than `ttlDays`; returns how many were pruned. */
  prune(ttlDays: number): Promise<number>;
}
```

### The pipeline (`@warden/traffic`)

```ts
export interface RunTrafficInput {
  cfg: WardenConfig;
  source: TrafficSource; // opt-in capture (SDK | proxy)
  store: TrafficStore; // scrubbed sessions only
  scrubber: PiiScrubber; // mandatory, runs before store.put
  clusterer: JourneyClusterer;
  synthesizer: TestSynthesizer; // reused from @warden/recorder
  cujProposer: CujProposer;
  provider: LLMProvider;
  gh: GitHubAccess; // reused from @warden/coverage-sync (draft PR)
  metrics?: MetricsEmitter; // reused from @warden/observability
  target: { repo: string; branch: string }; // where the draft PR opens
}

export interface TrafficRunSummary {
  status: 'disabled' | 'no-consent-traffic' | 'below-threshold' | 'proposed';
  ingested: number;
  redactions: number;
  clusters: JourneyCluster[];
  specs: GeneratedTest[];
  candidateCujs: CandidateCUJ[];
  draftPr?: { url: string; number: number };
}

export function runTraffic(input: RunTrafficInput): Promise<TrafficRunSummary>;
```

## Configuration

Additive `traffic` block on `WardenConfigSchema` — optional, defaulted, **off by default** (opt-in).

```ts
traffic: {
  enabled: false,                 // strictly opt-in; nothing captures unless true
  source: 'browser-sdk',          // 'browser-sdk' | 'reverse-proxy'
  sampleRate: 0.01,               // fraction of consenting sessions captured
  consent: {
    required: true,               // capture requires an explicit consent signal
    cookieName: 'warden_traffic_opt_in',
    honorDoNotTrack: true,        // DNT / GPC suppresses capture regardless of cookie
  },
  pii: {
    redactionToken: '[REDACTED]',
    // Built-in rules (email, phone, PAN/luhn, SSN, JWT/bearer, uuid-in-url) always apply.
    extraRules: [],               // additional { name, pattern, applyTo }
    // Allowlist model: ONLY these selector-name labels pass through unredacted.
    selectorAllowlist: ['Search', 'Category', 'Sort by', 'Quantity'],
  },
  retention: {
    storeRawAfterScrub: false,    // never persist unscrubbed capture; scrub in-memory at ingest
    scrubbedTtlDays: 30,          // retention sweep of the traffic store
  },
  clustering: {
    minSessions: 5,               // ignore clusters below this size
    topClusters: 20,              // synthesize at most this many, by weight
    businessWeightByRoute: {},    // e.g. { '/checkout/:id': 5, '/signup': 3 }
  },
  synthesis: {
    minClusterFrequency: 10,      // a cluster must recur this often to be synthesized
    proposeCujs: true,            // emit CandidateCUJ per cluster for §2.2
    outDir: 'tests/e2e/traffic/', // where synthesized specs land in the draft PR
  },
}
```

## Data flow

1. **Consent gate (prod).** The opt-in browser SDK checks `consent.cookieName` (and honors DNT/GPC);
   the reverse-proxy source only taps flagged, consenting sessions. Non-consenting traffic is never
   captured. Consenting sessions are sampled at `sampleRate`.
2. **Capture.** `TrafficSource.collect({ max })` returns `RawTrafficSession[]` — role-oriented
   interaction descriptors + navigations (the same low-data shape as the recorder's capture script),
   plus an `anonId`, a `consent` marker, and a `routeTemplate`.
3. **Scrub (mandatory, before storage).** `scrubber.scrub(raw)` redacts each step value, URL, and
   selector name against the built-in + configured rules; only `selectorAllowlist` labels pass
   through. With `storeRawAfterScrub: false` (default) the raw session is discarded in memory and
   **only the scrubbed `RecordedSession` is ever written** via `store.put`.
4. **Retention.** `store.prune(retention.scrubbedTtlDays)` sweeps expired scrubbed sessions on each
   run, enforcing the documented retention posture.
5. **Cluster.** On a schedule / CI job, `clusterer.cluster(store.list())` groups scrubbed sessions by
   a canonical step signature and ranks them `frequency × businessWeightByRoute` → `JourneyCluster[]`,
   dropping clusters below `clustering.minSessions`.
6. **Synthesize.** For each of the top `topClusters` clusters above `synthesis.minClusterFrequency`,
   the cluster's representative session flows into the reused `AiTestSynthesizer.synthesize(session,
provider)` → tagged Playwright specs (`@traffic` + a route tag), pathed under `synthesis.outDir`.
7. **Propose CUJs.** `cujProposer.propose(cluster, specs, provider)` names the journey and links the
   synthesized specs → `CandidateCUJ`, ready for §2.2 to adopt/gate.
8. **Publish.** `gh.openOrUpdateDraftPr(target.repo, target.branch, files, title, body)` opens/refreshes
   an idempotent **draft PR** with the new specs and a summary of the candidate CUJs. `MetricsEmitter`
   records ingested/redactions/clusters/specs. Candidate CUJs surface to the dashboard's CUJ board
   once §2.2 lands.
9. **Human review.** A reviewer approves and merges the draft PR. Warden never auto-merges captured
   traffic into the suite.

## Units & files

| File (`@warden/traffic/src/…`) | Responsibility                                                                                                                         | Deps                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `traffic-source.ts`            | `TrafficSource` seam + `browserSdkSource` (opt-in JS snippet → collector) and `reverseProxySource` (HAR/proxy tap → sessions) defaults | `@warden/core`                                                                                   |
| `pii-scrubber.ts`              | `defaultPiiScrubber` — built-in rules (email/phone/PAN-luhn/SSN/JWT/uuid-in-url), allowlist, fail-closed redaction                     | `@warden/core`                                                                                   |
| `journey-clusterer.ts`         | canonical step signature + `frequency × weight` ranking → `JourneyCluster[]`; deterministic representative pick                        | `@warden/core`                                                                                   |
| `cuj-proposer.ts`              | `AiCujProposer` — LLM names the journey, links synthesized specs → `CandidateCUJ`                                                      | `@warden/core` (`LLMProvider`)                                                                   |
| `traffic-store.ts`             | `fsTrafficStore` / `sqliteTrafficStore` implementing `TrafficStore` (put/list/prune)                                                   | `@warden/core`                                                                                   |
| `retention.ts`                 | retention sweeper wrapping `store.prune`, driven by config                                                                             | `@warden/core`                                                                                   |
| `run.ts`                       | the pipeline: consent-aware collect → scrub → store → prune → cluster → synthesize → propose → publish; returns `TrafficRunSummary`    | recorder (`AiTestSynthesizer`), coverage-sync (`GitHubAccess`), observability (`MetricsEmitter`) |
| `collector.ts`                 | a small self-hostable HTTP collector the browser SDK POSTs to (for `deploy/`); thin wiring only                                        | `@warden/core`                                                                                   |
| `testing-fakes.ts`             | `fakeTrafficSource`, `inMemoryTrafficStore`, PII fixtures with real-looking email/PAN/JWT                                              | `@warden/core/testing`                                                                           |
| `index.ts`                     | barrel export                                                                                                                          | —                                                                                                |

Every unit is small and single-purpose, mirroring `@warden/coverage-sync`'s layout (a `run.ts`
pipeline over injected seams, one `*.test.ts` per unit, a `testing-fakes.ts`).

## Safety & error handling

PII/consent is the whole point of this design, so safety is a first-class requirement, not a footnote:

- **Opt-in by default.** `traffic.enabled` is `false`; `runTraffic` returns `status: 'disabled'`
  immediately when off. Capture additionally requires a per-session consent signal; DNT/GPC suppress
  capture even when the cookie is present.
- **Scrub-before-store.** With `storeRawAfterScrub: false` (default) the raw `RawTrafficSession` is
  never persisted — scrubbing runs in memory at ingest and only the clean `RecordedSession` is stored.
- **Fail-closed redaction.** If a rule throws or a value is an unrecognized shape, the scrubber
  redacts the whole value rather than passing it through. The scrubber uses an **allowlist** for
  selector labels (only known-safe labels survive), never a denylist.
- **Retention enforced.** Every run prunes scrubbed sessions past `scrubbedTtlDays`; the collector
  and store document their retention window (the §2.6 data-handling prerequisite).
- **Least data.** Capture is role-oriented interaction descriptors + navigations, not raw DOM,
  form values, or screenshots.
- **No auto-merge.** Synthesized specs and CUJ proposals are only ever a **draft PR**; a human merges.
  Draft-PR publishing is idempotent (same branch refreshes, no duplicates), inherited from
  coverage-sync.
- **Bounded.** `sampleRate`, `collect({ max })`, `minSessions`, `topClusters`, and
  `minClusterFrequency` cap volume; whatever is skipped is stated in `TrafficRunSummary`
  (`status: 'no-consent-traffic' | 'below-threshold'`), never silently dropped.
- **No-op safety.** If no consenting/sampled sessions arrive, or nothing clears the threshold, the run
  returns a benign summary and opens no PR.

## Testing

Fully hermetic, matching the rest of Warden — no live traffic, browser, network, or LLM in unit tests:

- **`PiiScrubber`** — fixture `RawTrafficSession`s carrying a real-looking email, a Luhn-valid PAN, a
  bearer JWT, and an SSN in step values, URLs, and selector names. Assert **every** match is replaced
  with the redaction token, allowlisted labels survive verbatim, and a throwing custom rule fails
  closed (value fully redacted). The load-bearing assertion: **the raw PII strings appear in no
  scrubbed session, cluster, spec, or store entry.**
- **`JourneyClusterer`** — fixture scrubbed sessions with two shared signatures + noise; assert
  grouping, `frequency × weight` ranking against `businessWeightByRoute`, the deterministic
  representative pick, and that sub-`minSessions` clusters are dropped.
- **`AiTestSynthesizer` reuse** — a representative session + `fakeProvider` (from
  `@warden/core/testing`) returning a canned flow JSON → assert tagged (`@traffic`) role-based specs
  under `outDir`.
- **`CujProposer`** — a cluster + `fakeProvider` → asserted `CandidateCUJ` (name, signature,
  `testPaths` linked to the synthesized specs).
- **`TrafficStore` / retention** — `inMemoryTrafficStore`; assert `prune(ttlDays)` drops only expired
  sessions and returns the count.
- **`runTraffic` end-to-end** — `fakeTrafficSource` (consenting + non-consenting + PII-laden fixtures),
  `inMemoryTrafficStore`, `defaultPiiScrubber`, a fake clusterer/synthesizer/proposer, `fakeProvider`,
  and a mock `GitHubAccess`. Assert: non-consenting traffic is never ingested; **no raw session is
  stored** when `storeRawAfterScrub` is false; the draft-PR payload contains the synthesized specs and
  a CUJ summary (`draft: true`, stable branch); `MetricsEmitter` received ingest/scrub/cluster counts;
  and the below-threshold path opens no PR. A real SDK/proxy capture is exercised only in a dogfood run.

## Rollout

1. **Core + engine.** Add `packages/core/src/traffic.ts` types + the `traffic` config block, and build
   `@warden/traffic` (source seam, `defaultPiiScrubber`, clusterer, `cuj-proposer`, `traffic-store`,
   `retention`, `run`) — all hermetically testable, no live traffic required.
2. **Sources + collector.** Ship `browserSdkSource` (opt-in JS snippet) and `reverseProxySource`, plus
   a self-hostable `collector` in `deploy/`, with the consent gate and retention sweeper wired.
3. **Synthesis + publish.** Wire the reused `AiTestSynthesizer` and the coverage-sync `GitHubAccess`
   publisher; open draft PRs; emit metrics. Surface `CandidateCUJ`s to the dashboard behind a flag,
   pending §2.2's CUJ entity.
4. **Dogfood.** Point the SDK at a demo app fed with **synthetic** "production" traffic (including
   deliberately PII-laden sessions); verify scrub correctness, cluster ranking, a real draft-PR of
   specs, and CUJ proposals.
5. **Document** consent, sampling, scrubbing rules, retention TTLs, and the data-handling posture in
   `docs/` (shared with the §2.6 enterprise-readiness write-up).

## Risks & open items

- **Compliance is the hard part.** Consent capture, regional (GDPR/CCPA) obligations, and a defensible
  retention posture gate real production use. First version is opt-in, scrub-before-store, DNT-honoring,
  and TTL-bounded; the full legal/data-handling posture is co-owned with §2.6. Recommend teams run
  against **staging traffic first**.
- **Scrubbing is best-effort.** Rule-based redaction can have false negatives on unusual PII shapes.
  The allowlist model and fail-closed default reduce leakage but cannot eliminate it; the scrub rule
  set needs review and an easy path to extend (`pii.extraRules`).
- **Clustering fidelity.** Signature-based grouping may over- or under-merge journeys; the first
  version keeps grouping deterministic (LLM only _names_ the journey), and lets `businessWeightByRoute`
  bias ranking. Smarter clustering is future work.
- **`CandidateCUJ` depends on §2.2.** Until the CUJ entity/board/gating land, proposals are stored and
  surfaced but not gated. This proposal deliberately ships only the feeder shape.
- **Source fidelity.** The reverse-proxy source reconstructs UI journeys from HTTP exchanges and is
  lossier than the browser SDK; the SDK is the higher-fidelity default, with the proxy as a fallback
  for apps that cannot inject a snippet.
- **Collector is a running service.** Unlike the zero-infra Action, the browser-SDK path needs a
  collector endpoint. It ships in `deploy/`, but self-hosting + the consent/retention configuration
  are new operational steps.
