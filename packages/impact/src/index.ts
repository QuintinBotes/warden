/**
 * `@warden/impact` — Test Impact Analysis. Pure, hermetic units that map a change surface to the
 * tests a coverage index says it impacts, plus a safety net for uncovered files. Depends only on
 * `@warden/core`; the CLI/orchestrator composes {@link selectWithImpact} at the bin layer. See
 * docs/proposals/2026-07-09-tier-3-roadmap.md §1.
 */
export {
  loadCoverageIndex,
  readCoverageIndex,
  type CoverageFileAccess,
} from './load-coverage-index.js';
export { computeImpact } from './compute-impact.js';
export { impactToGrep, selectWithImpact, type ImpactSelection } from './impact-to-grep.js';
