import type { RecordedSession, GeneratedTest } from './v2';
import type { LLMProvider } from './llm';

/**
 * Production-traffic recording contract surface (additive to `@warden/core`). These are the
 * shared seams the `@warden/traffic` pipeline is built from: an opt-in capture source, a
 * mandatory fail-closed PII scrubber, a deterministic journey clusterer, an LLM-backed CUJ
 * proposer, and a durable store for scrubbed sessions. Nothing here changes a V1/V2 signature;
 * every collaborator is an interface so the pipeline is fully injectable and hermetically
 * unit-testable with no live traffic, browser, network, or LLM.
 *
 * See docs/proposals/2026-07-08-traffic-recording.md.
 */

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

/** Which field a redaction rule targets. */
export type PiiApplyTo = 'value' | 'selectorName' | 'url';

/** A single redaction rule: a name, a matcher, and whether it targets keys or values. */
export interface PiiRule {
  name: string; // e.g. 'email', 'pan', 'jwt'
  pattern: RegExp;
  applyTo: PiiApplyTo;
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
 * the CUJ modeling proposal owns the full `Cuj` entity/board/gating; this is the feeder shape
 * it consumes.
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
