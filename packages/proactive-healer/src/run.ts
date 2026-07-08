import type {
  FileAccess,
  GitHubAccess,
  HealRateSummary,
  LLMProvider,
  LocatorResolution,
  PrRef,
  ProactiveHealSuggestion,
  TestCase,
  WardenConfig,
} from '@warden/core';
import { extractLocators } from './locator-extractor.js';
import { resolveLocators, type LocatingSession } from './locator-resolver.js';
import { suggestRepairs } from './locator-repair-suggester.js';
import { summarizeHealRate } from './summarize-heal-rate.js';
import { publishProactiveHeal } from './publisher.js';

/**
 * The heal-rate metric sink. A structural subset of `@warden/core`'s `MetricsEmitter`, so a real
 * emitter (once it grows `emitHeal`) satisfies it, and hermetic tests can inject a recorder.
 * `emitHeal` is optional — a metrics emitter that doesn't implement it simply records nothing.
 */
export interface HealMetricsEmitter {
  emitHeal?(
    summary: HealRateSummary,
    meta: { pr?: number; mode: 'proactive' | 'reactive' },
  ): Promise<void>;
}

/** Everything `runProactiveHeal` needs, with every external collaborator injected. */
export interface RunProactiveHealInput {
  /** Affected test cases (already scoped by `scopeToAffectedTags` upstream). */
  testCases: TestCase[];
  fileAccess: FileAccess;
  /** A browser session already launched against the PR's preview build. */
  session: LocatingSession;
  provider: LLMProvider;
  gh: GitHubAccess;
  metrics?: HealMetricsEmitter;
  cfg: WardenConfig;
  sourcePr: PrRef;
}

export type ProactiveHealStatus = 'no-preview' | 'unsupported-engine' | 'checked';

export interface ProactiveHealRunSummary {
  status: ProactiveHealStatus;
  summary: HealRateSummary;
  resolutions: LocatorResolution[];
  suggestions: ProactiveHealSuggestion[];
  branch?: string;
  draftPr?: { url: string; number: number };
  checkPosted: boolean;
  emittedHeal: boolean;
  note: string;
}

const CHECK_TITLE = 'Warden proactive healing';

/**
 * Orchestrates the proactive-heal pass: extract → resolve → suggest → summarize → publish →
 * `emitHeal`. Every collaborator (`FileAccess`, `BrowserSession`, `LLMProvider`, `GitHubAccess`,
 * `MetricsEmitter`) is injected, so the whole pipeline is unit-testable without a live browser,
 * network, or LLM.
 *
 * Two-key activation: without a configured `previewUrlTemplate` it posts a neutral
 * "no preview URL configured" check and returns — never a silent no-op. When the engine has no
 * `locate()` it posts a neutral "unsupported engine" check rather than claiming a 100% heal rate.
 * The heal metric is emitted only when locators were actually probed.
 */
export async function runProactiveHeal(
  input: RunProactiveHealInput,
): Promise<ProactiveHealRunSummary> {
  const { cfg, gh, sourcePr } = input;
  const heal = cfg.proactiveHealing;

  if (!heal.previewUrlTemplate) {
    const note =
      'No preview URL configured (proactiveHealing.previewUrlTemplate); nothing checked.';
    await gh.postCheckRun(sourcePr, 'neutral', CHECK_TITLE, note);
    return neutralOutcome('no-preview', note);
  }

  const refs = await extractLocators(input.testCases, input.fileAccess);
  const cap = heal.maxLocatorsPerRun;
  const capped = refs.slice(0, cap);
  const skippedByCap = refs.length - capped.length;

  const { resolutions, skippedReason } = await resolveLocators(capped, input.session);
  if (skippedReason) {
    const note = `Proactive healing unsupported for engine "${cfg.browser.engine}": ${skippedReason}.`;
    await gh.postCheckRun(sourcePr, 'neutral', CHECK_TITLE, note);
    return neutralOutcome('unsupported-engine', note);
  }

  const suggestions = await suggestRepairs(resolutions, input.session, input.provider, {
    minConfidence: heal.minConfidence,
    model: cfg.ai.model,
  });

  const summary = summarizeHealRate(resolutions, suggestions);

  const notes: string[] = [];
  if (skippedByCap > 0) {
    notes.push(`skipped ${skippedByCap} locator(s) over the maxLocatorsPerRun cap (${cap}).`);
  }

  const published = await publishProactiveHeal(suggestions, summary, sourcePr, gh, { notes });

  let emittedHeal = false;
  if (input.metrics?.emitHeal) {
    await input.metrics.emitHeal(summary, { pr: sourcePr.number, mode: 'proactive' });
    emittedHeal = true;
  }

  return {
    status: 'checked',
    summary,
    resolutions,
    suggestions,
    branch: published.branch,
    draftPr: published.draftPr,
    checkPosted: published.checkPosted,
    emittedHeal,
    note: `Checked ${summary.checked} locator(s); published ${published.suggested} draft suggestion(s).`,
  };
}

function neutralOutcome(status: ProactiveHealStatus, note: string): ProactiveHealRunSummary {
  return {
    status,
    summary: emptySummary(),
    resolutions: [],
    suggestions: [],
    checkPosted: true,
    emittedHeal: false,
    note,
  };
}

function emptySummary(): HealRateSummary {
  return { checked: 0, resolved: 0, missing: 0, ambiguous: 0, suggested: 0, healRate: 1 };
}
