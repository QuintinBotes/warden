/**
 * `@warden/orchestrator` (WS-10) — diff analysis, scope selection, risk scoring, and gate
 * evaluation. The core of the package is a set of pure functions over an explicit
 * `DiffFile[]`, plus one thin git integration (`analyzeChangeSurface`).
 */
export { scoreRisk } from './score-risk';
export { computeChangeSurface } from './compute-change-surface';
export { selectTiers } from './select-tiers';
export { evaluateExitCriteria } from './evaluate-exit-criteria';
export { dispatchAgents } from './dispatch-agents';
export { analyzeChangeSurface, parseNameStatus } from './analyze-change-surface';
export { firePluginHooks, type PluginHookOutcome } from './fire-plugin-hooks';
