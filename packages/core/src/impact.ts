/**
 * Test Impact Analysis (TIA) contracts — the shared types the impact engine
 * (`@warden/impact`) produces and the orchestrator/CLI consume. Additive to `@warden/core`:
 * a new module plus an `impact` config block on `WardenConfigSchema` (see `config.ts`) — nothing
 * existing changes.
 *
 * A coverage index maps each test to the source files it exercised on a prior run. Intersecting
 * it with a change surface's `changedFiles` yields exactly the impacted tests (each with a reason
 * naming the file), plus a `safetyNet` for changed files no test covers so a brand-new file is
 * never silently skipped. See docs/proposals/2026-07-09-tier-3-roadmap.md §1.
 */

/** One test's file-level coverage footprint, captured on a prior (coverage-enabled) run. */
export interface CoverageIndexEntry {
  testId: string;
  testName: string;
  files: string[];
}

/** The full per-test → per-file coverage map a coverage run produces. */
export type CoverageIndex = CoverageIndexEntry[];

/** A test the change surface impacts, with why it matched. */
export interface ImpactedTest {
  testId: string;
  testName: string;
  reason: string;
}

/** The result of intersecting a change surface with a coverage index. */
export interface ImpactResult {
  /** Impacted tests, deduped by `testId`. */
  impacted: ImpactedTest[];
  /** Changed files no index entry covers — the input to the `onUncovered` policy. */
  uncoveredChangedFiles: string[];
  /**
   * True when there are uncovered changed files AND the policy is not `warn` — i.e. the run must
   * escalate (run all / run tagged) rather than trust the narrowed set.
   */
  safetyNet: boolean;
}
