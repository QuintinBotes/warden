/**
 * Proactive self-healing contracts (additive). An *optional* pass that runs alongside the
 * default, reactive `HealerStrategy`: when a PR's change surface shows UI drift, Warden
 * pre-emptively re-resolves the role/label locators used by the affected tests against the
 * PR's preview build and opens a DRAFT healing PR for any locator that no longer resolves —
 * before the tests are ever run and go red.
 *
 * These are the shared types only; `@warden/proactive-healer` implements the pipeline and
 * opens its draft PR through the exact same `GitHubAccess` seam `@warden/coverage-sync` uses
 * (`RepoTarget`, `GitHubAccess`, `FileAccess`, `PrRef`, `DraftPrResult` are reused as-is from
 * `./coverage-sync`).
 *
 * This feature is off by default and is NEVER a gate input: its check-run is always `neutral`,
 * so it can never turn a PASS into a WARN/BLOCK. It does not replace the reasoning healer.
 */

/** One role/label locator call found in a test spec, with its source location. */
export interface LocatorRef {
  filePath: string;
  line: number;
  /** Resolved from `TestCase.automation.filePath`/`testName` when known. */
  testCaseId?: string;
  kind: 'click' | 'fill';
  /** ARIA role for `click`; for `fill` (a `getByLabel`) this is the sentinel `'label'`. */
  role: string;
  /** Accessible name for `click`; label text for `fill`. */
  name: string;
}

export type LocatorStatus = 'resolved' | 'ambiguous' | 'missing';

export interface LocatorResolution {
  locator: LocatorRef;
  status: LocatorStatus;
  matchCount: number;
}

export type HealConfidence = 'high' | 'medium' | 'low';

export interface ProactiveHealSuggestion {
  locator: LocatorRef;
  /** Best-guess replacement name, proposed by the LLM from the live page's accessible tree. */
  suggestedName: string;
  confidence: HealConfidence;
  /** Unified diff against `locator.filePath`. Empty when no confident repair was produced. */
  patch: string;
  reason: string;
}

export interface HealRateSummary {
  checked: number;
  resolved: number;
  missing: number;
  ambiguous: number;
  /** Suggestions carrying a patch that parsed cleanly as a unified diff. */
  suggested: number;
  /** `resolved / checked`, or `1` when `checked === 0`. */
  healRate: number;
}
