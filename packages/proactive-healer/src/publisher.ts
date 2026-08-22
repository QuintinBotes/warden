import type {
  FileAccess,
  GitHubAccess,
  HealRateSummary,
  PrRef,
  ProactiveHealSuggestion,
  RepoTarget,
} from '@warden/core';
import { applyUnifiedDiff } from '@warden/core';
import { isUnifiedDiff } from './patch-utils.js';

/**
 * Fixed, honest framing shown on every proactive-heal check-run. Keeps a heal-rate number from
 * being read as a quality score on its own (see the proposal's §2.3 refutation).
 */
export const PROACTIVE_HEAL_NOTE =
  'Note: proactive healing is an optional posture, not a replacement for the reasoning healer — a heal-rate number is not a quality score on its own.';

export interface ProactiveHealPublishResult {
  branch: string;
  /** Present only when there was at least one patch that applied to its file. */
  draftPr?: { url: string; number: number };
  checkPosted: boolean;
  /** Number of suggestions actually published (those whose patch applied to the real file). */
  suggested: number;
  /** Suggestions that were NOT published, each with the reason the patch could not be applied. */
  unapplied: UnappliedSuggestion[];
}

/** A suggestion that carried a diff but could not be turned into a file change. */
export interface UnappliedSuggestion {
  path: string;
  line: number;
  reason: string;
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
 * - Suggestions carrying a parsed unified-diff `patch` have that patch APPLIED to the file as
 *   `fileAccess` reads it, and it is the resulting whole file — never the diff text — that is
 *   published. `openOrUpdateDraftPr` writes whole file contents (the GitHub contents API takes
 *   nothing else), so handing it a diff replaces the target file with five lines of `@@`.
 * - Everything that applies goes into ONE idempotent draft PR on
 *   `warden/proactive-heal-pr-<n>`, one entry per file. A patch that does not apply is not
 *   committed and is named, with its reason, on the check-run — never dropped in silence.
 *   When nothing applies, no PR is opened.
 * - A check-run is *always* posted to the source PR, and its conclusion is *always* `neutral` —
 *   proactive healing is never a gate input, so a slow/flaky preview can't turn a PASS into a BLOCK.
 */
export async function publishProactiveHeal(
  suggestions: ProactiveHealSuggestion[],
  summary: HealRateSummary,
  sourcePr: PrRef,
  gh: GitHubAccess,
  fileAccess: FileAccess,
  opts: PublishProactiveHealOptions = {},
): Promise<ProactiveHealPublishResult> {
  const branch = proactiveHealBranchName(sourcePr);
  const withPatch = suggestions.filter((s) => isUnifiedDiff(s.patch));
  const { files, published, unapplied } = await applyPatchesPerFile(withPatch, fileAccess);

  let draftPr: { url: string; number: number } | undefined;
  if (files.length > 0) {
    const draft = await gh.openOrUpdateDraftPr(
      repoTargetOf(sourcePr),
      branch,
      files,
      titleFor(sourcePr),
      prBody(published, summary, sourcePr),
    );
    draftPr = { url: draft.url, number: draft.number };
  }

  const notes = [...(opts.notes ?? []), ...unappliedNotes(unapplied)];
  await gh.postCheckRun(
    sourcePr,
    'neutral',
    titleFor(sourcePr),
    checkBody(summary, published.length, notes),
  );

  return { branch, draftPr, checkPosted: true, suggested: published.length, unapplied };
}

/**
 * Turn each file's suggestions into ONE whole-file entry, by applying their patches in order to
 * the file as it stands. A patch that does not apply is reported instead of written: the file it
 * targets is a real test the agent was asked to propose a change to, not to overwrite.
 */
async function applyPatchesPerFile(
  suggestions: ProactiveHealSuggestion[],
  fileAccess: FileAccess,
): Promise<{
  files: { path: string; content: string }[];
  published: ProactiveHealSuggestion[];
  unapplied: UnappliedSuggestion[];
}> {
  const byPath = new Map<string, ProactiveHealSuggestion[]>();
  for (const s of suggestions) {
    const group = byPath.get(s.locator.filePath) ?? [];
    group.push(s);
    byPath.set(s.locator.filePath, group);
  }

  const files: { path: string; content: string }[] = [];
  const published: ProactiveHealSuggestion[] = [];
  const unapplied: UnappliedSuggestion[] = [];

  for (const [path, group] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const original = await fileAccess.readFile(path);
    if (original === null) {
      for (const s of group) {
        unapplied.push({ path, line: s.locator.line, reason: 'file could not be read' });
      }
      continue;
    }

    let content = original;
    const applied: ProactiveHealSuggestion[] = [];
    for (const s of group) {
      const result = applyUnifiedDiff(content, s.patch);
      if (!result.ok) {
        unapplied.push({ path, line: s.locator.line, reason: result.reason });
        continue;
      }
      content = result.content;
      applied.push(s);
    }

    // An applied patch that changed nothing is not a file change worth committing.
    if (applied.length === 0 || content === original) continue;
    files.push({ path, content });
    published.push(...applied);
  }

  return { files, published, unapplied };
}

/** One check-run line per unpublished suggestion — an absent repair is stated, never implied. */
function unappliedNotes(unapplied: UnappliedSuggestion[]): string[] {
  return unapplied.map((u) => `not published: ${u.path}:${u.line} — ${u.reason}.`);
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
