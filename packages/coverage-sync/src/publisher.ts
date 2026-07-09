import type { GitHubAccess, PrRef, Recommendation, RepoTarget } from '@warden/core';
import { slugify } from '@warden/core';

/** Result of publishing recommendations: one entry per external draft PR + self-suggestion count. */
export interface PublishResult {
  draftPrs: { repo: string; url: string; number: number }[];
  selfSuggested: number;
}

/** Slugify a repo target into a branch-safe token: `org/e2e-tests` -> `org-e2e-tests`. */
export function slug(repo: RepoTarget): string {
  return slugify(repo).toLowerCase();
}

/**
 * The idempotent draft-PR branch name for a given target repo + source PR.
 *
 * Deterministic in its inputs (no timestamps / randomness) so re-running on the
 * same source PR targets the *same* branch and updates the existing draft PR
 * instead of opening a duplicate.
 */
export function syncBranchName(repo: RepoTarget, sourcePr: PrRef): string {
  return `warden/sync-${slug(repo)}-pr-${sourcePr.number}`;
}

/**
 * Publish recommendations to GitHub over an injected {@link GitHubAccess}.
 *
 * Recommendations are grouped by `targetRepo`:
 * - `self` → attached to the source PR as review suggestions (`addPrSuggestions`)
 *   for `add`/`update` recs (removals can't be a content suggestion and are left
 *   to the summary check).
 * - any other repo → an idempotent draft PR (`openOrUpdateDraftPr`) on a stable
 *   branch, with `content: null` entries for `remove` recs (deletions in the diff).
 *
 * A summary check run is *always* posted to the source PR: `success` when there
 * was at least one recommendation, `neutral` otherwise.
 */
export async function publish(
  recs: Recommendation[],
  sourcePr: PrRef,
  gh: GitHubAccess,
): Promise<PublishResult> {
  const byRepo = new Map<RepoTarget, Recommendation[]>();
  for (const rec of recs) {
    const group = byRepo.get(rec.targetRepo) ?? [];
    group.push(rec);
    byRepo.set(rec.targetRepo, group);
  }

  const draftPrs: PublishResult['draftPrs'] = [];
  let selfSuggested = 0;

  for (const [repo, group] of byRepo) {
    if (repo === 'self') {
      const files = group
        .filter((rec) => rec.action !== 'remove')
        .map((rec) => ({ path: rec.path, content: rec.content ?? rec.patch ?? '' }));
      if (files.length > 0) {
        await gh.addPrSuggestions(sourcePr, files, summarize(group));
        selfSuggested += files.length;
      }
      continue;
    }

    const files = group.map((rec) => ({
      path: rec.path,
      content: rec.action === 'remove' ? null : (rec.content ?? rec.patch ?? ''),
    }));
    const branch = syncBranchName(repo, sourcePr);
    const title = `Warden coverage sync — PR #${sourcePr.number}`;
    const result = await gh.openOrUpdateDraftPr(
      repo,
      branch,
      files,
      title,
      prBody(group, sourcePr),
    );
    draftPrs.push({ repo, url: result.url, number: result.number });
  }

  const title = `Warden coverage sync — PR #${sourcePr.number}`;
  await gh.postCheckRun(sourcePr, recs.length > 0 ? 'success' : 'neutral', title, summarize(recs));

  return { draftPrs, selfSuggested };
}

/** A one-line-per-recommendation human summary, grouped by kind/action. */
function summarize(recs: Recommendation[]): string {
  if (recs.length === 0) return 'No recommendations.';
  const lines = recs.map(
    (rec) => `- ${rec.action} ${rec.kind}: ${rec.path} (${rec.targetRepo}) — ${rec.reason}`,
  );
  return lines.join('\n');
}

/** The draft-PR body for one target repo's recommendations. */
function prBody(recs: Recommendation[], sourcePr: PrRef): string {
  return [
    `Proposed by Warden coverage sync from ${sourcePr.owner}/${sourcePr.repo}#${sourcePr.number}.`,
    '',
    summarize(recs),
  ].join('\n');
}
