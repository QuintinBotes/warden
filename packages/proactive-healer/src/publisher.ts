import type {
  GitHubAccess,
  HealRateSummary,
  PrRef,
  ProactiveHealSuggestion,
  RepoTarget,
} from '@warden/core';
import { isUnifiedDiff } from './patch-utils.js';

/**
 * Fixed, honest framing shown on every proactive-heal check-run. Keeps a heal-rate number from
 * being read as a quality score on its own (see the proposal's §2.3 refutation).
 */
export const PROACTIVE_HEAL_NOTE =
  'Note: proactive healing is an optional posture, not a replacement for the reasoning healer — a heal-rate number is not a quality score on its own.';

export interface ProactiveHealPublishResult {
  branch: string;
  /** Present only when there was at least one confident patch to publish. */
  draftPr?: { url: string; number: number };
  checkPosted: boolean;
  /** Number of suggestions actually published (those carrying a parsed patch). */
  suggested: number;
}

export interface PublishProactiveHealOptions {
  /** Extra neutral-context lines for the check-run body (e.g. cap / engine-skip reasons). */
  notes?: string[];
}

/**
 * The idempotent draft-PR branch for a source PR. Deterministic (no timestamps/randomness), so
 * re-running on the same PR targets the *same* branch and updates the existing draft PR instead
 * of stacking duplicates — matching `@warden/coverage-sync`'s publisher.
 */
export function proactiveHealBranchName(sourcePr: PrRef): string {
  return `warden/proactive-heal-pr-${sourcePr.number}`;
}

function titleFor(sourcePr: PrRef): string {
  return `Warden proactive healing — PR #${sourcePr.number}`;
}

function repoTargetOf(sourcePr: PrRef): RepoTarget {
  return `${sourcePr.owner}/${sourcePr.repo}`;
}

/**
 * Publishes proactive-heal suggestions via the injected {@link GitHubAccess}:
 *
 * - Suggestions carrying a parsed unified-diff `patch` are collected into ONE idempotent draft PR
 *   on `warden/proactive-heal-pr-<n>` (`openOrUpdateDraftPr`), grouped per target file. When there
 *   is nothing confident to heal, no PR is opened.
 * - A check-run is *always* posted to the source PR, and its conclusion is *always* `neutral` —
 *   proactive healing is never a gate input, so a slow/flaky preview can't turn a PASS into a BLOCK.
 */
export async function publishProactiveHeal(
  suggestions: ProactiveHealSuggestion[],
  summary: HealRateSummary,
  sourcePr: PrRef,
  gh: GitHubAccess,
  opts: PublishProactiveHealOptions = {},
): Promise<ProactiveHealPublishResult> {
  const branch = proactiveHealBranchName(sourcePr);
  const withPatch = suggestions.filter((s) => isUnifiedDiff(s.patch));

  let draftPr: { url: string; number: number } | undefined;
  if (withPatch.length > 0) {
    const files = groupPatchesByPath(withPatch);
    const draft = await gh.openOrUpdateDraftPr(
      repoTargetOf(sourcePr),
      branch,
      files,
      titleFor(sourcePr),
      prBody(withPatch, summary, sourcePr),
    );
    draftPr = { url: draft.url, number: draft.number };
  }

  await gh.postCheckRun(
    sourcePr,
    'neutral',
    titleFor(sourcePr),
    checkBody(summary, withPatch.length, opts.notes ?? []),
  );

  return { branch, draftPr, checkPosted: true, suggested: withPatch.length };
}

/** One file entry per target path, concatenating the per-locator patches for that file. */
function groupPatchesByPath(
  suggestions: ProactiveHealSuggestion[],
): { path: string; content: string }[] {
  const byPath = new Map<string, string[]>();
  for (const s of suggestions) {
    const group = byPath.get(s.locator.filePath) ?? [];
    group.push(s.patch.trimEnd());
    byPath.set(s.locator.filePath, group);
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, patches]) => ({ path, content: `${patches.join('\n')}\n` }));
}

function prBody(
  suggestions: ProactiveHealSuggestion[],
  summary: HealRateSummary,
  sourcePr: PrRef,
): string {
  const lines = [
    `Proposed by Warden proactive healing for ${sourcePr.owner}/${sourcePr.repo}#${sourcePr.number}.`,
    '',
    PROACTIVE_HEAL_NOTE,
    '',
    healLine(summary),
    '',
  ];
  for (const s of suggestions) {
    lines.push(
      `- ${s.locator.filePath}:${s.locator.line} — ${s.locator.kind} "${s.locator.name}" → "${s.suggestedName}" (${s.confidence}): ${s.reason}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function checkBody(summary: HealRateSummary, published: number, notes: string[]): string {
  const lines = [healLine(summary), `published: ${published} draft suggestion(s)`];
  for (const note of notes) lines.push(note);
  lines.push('', PROACTIVE_HEAL_NOTE, '');
  return lines.join('\n');
}

function healLine(summary: HealRateSummary): string {
  const pct = (summary.healRate * 100).toFixed(1);
  return `checked ${summary.checked} · resolved ${summary.resolved} · missing ${summary.missing} · ambiguous ${summary.ambiguous} · suggested ${summary.suggested} · heal-rate ${pct}%`;
}
