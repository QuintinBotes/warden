/**
 * `@warden/proactive-healer` — an *optional*, off-by-default pass that runs alongside the
 * reactive `HealerStrategy`. On a PR whose change surface shows UI drift, it re-resolves the
 * role/label locators used by the affected tests against the PR's preview build and opens a
 * DRAFT healing PR for any that no longer resolve — before the tests are run and go red.
 *
 * It never gates (its check-run is always `neutral`) and never replaces the reasoning healer.
 * Every collaborator (browser session, LLM provider, GitHub access, file access, metrics) is
 * injected, so the whole pipeline is unit-testable without a live browser or GitHub.
 */
export { shouldRunProactiveHeal } from './should-run-proactive-heal.js';
export { extractLocators } from './locator-extractor.js';
export {
  resolveLocators,
  type LocatingSession,
  type ResolveLocatorsResult,
} from './locator-resolver.js';
export {
  suggestRepairs,
  PROACTIVE_HEAL_SYSTEM_PROMPT,
  type SuggestRepairsOptions,
} from './locator-repair-suggester.js';
export { summarizeHealRate } from './summarize-heal-rate.js';
export { isUnifiedDiff, renderLocatorCall, buildLocatorPatch } from './patch-utils.js';
export {
  publishProactiveHeal,
  proactiveHealBranchName,
  PROACTIVE_HEAL_NOTE,
  type ProactiveHealPublishResult,
  type PublishProactiveHealOptions,
} from './publisher.js';
export {
  runProactiveHeal,
  type RunProactiveHealInput,
  type ProactiveHealRunSummary,
  type ProactiveHealStatus,
  type HealMetricsEmitter,
} from './run.js';
