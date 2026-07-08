/**
 * `@warden/traffic` — the opt-in production-traffic recorder. Captures real, consenting, sampled
 * user sessions, scrubs PII fail-closed BEFORE anything durable is written, clusters them into
 * ranked candidate journeys, hands the high-value clusters to the reused `TestSynthesizer` to
 * synthesize tagged Playwright specs, proposes a candidate CUJ per cluster, and publishes them as
 * a DRAFT PR via the coverage-sync `GitHubAccess`. Strictly opt-in, nothing auto-merges, and the
 * whole engine is hermetically testable — every collaborator is injected.
 *
 * The additive contract types (`RawTrafficSession`, `TrafficSource`, `PiiScrubber`,
 * `JourneyCluster`, `JourneyClusterer`, `CandidateCUJ`, `CujProposer`, `TrafficStore`) live in
 * `@warden/core`; this package ships the implementations and the `runTraffic` pipeline.
 */

// Pipeline
export {
  runTraffic,
  type RunTrafficInput,
  type TrafficRunSummary,
  type TrafficMetrics,
  type TrafficRunCounts,
} from './run.js';

// PII scrub (mandatory, fail-closed)
export {
  defaultPiiScrubber,
  luhnValid,
  type DefaultPiiScrubberOptions,
  type ReportingPiiScrubber,
} from './pii-scrubber.js';

// Deterministic journey clustering
export {
  createJourneyClusterer,
  routeTemplateOf,
  type JourneyClustererOptions,
} from './journey-clusterer.js';

// LLM-named candidate CUJ proposals
export { AiCujProposer, createCujProposer, buildCujNamingPrompt } from './cuj-proposer.js';

// Durable store + retention
export {
  fsTrafficStore,
  type TrafficStoreFs,
  type FsTrafficStoreOptions,
} from './traffic-store.js';
export { createRetentionSweeper, type RetentionSweeper } from './retention.js';

// Opt-in capture sources
export {
  browserSdkSource,
  reverseProxySource,
  admitCapture,
  type CapturedSessionInput,
  type BrowserSdkSourceOptions,
  type ReverseProxySourceOptions,
} from './traffic-source.js';

// Self-hostable collector core
export {
  createCollectorHandler,
  type CollectorHandler,
  type CollectorRequest,
  type CollectorResponse,
  type CollectorHandlerOptions,
} from './collector.js';
