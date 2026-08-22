import type { FileAccess, GitHubAccess, PrRef, Recommendation, RepoTarget } from '@warden/core';
import { applyUnifiedDiff, slugify } from '@warden/core';

/** Result of publishing recommendations: one entry per external draft PR + self-suggestion count. */
export interface PublishResult {
  draftPrs: { repo: string; url: string; number: number }[];
  selfSuggested: number;
  /** Recommendations that were NOT published, each with the reason its patch could not be applied. */
  unpublished: UnpublishedRecommendation[];
}

/** A recommendation whose proposed change could not be turned into file contents. */
export interface UnpublishedRecommendation {
  repo: RepoTarget;
  path: string;
  reason: string;
}

export interface PublishOptions {
  /**
   * Read access to a target repo, used to turn a `patch` recommendation into the whole file it
   * proposes. Both sinks below take file CONTENTS, so without a reader a patch-only
   * recommendation cannot be published — it is reported instead of guessed at.
   */
  fileAccessFor?: (repo: RepoTarget) => FileAccess;
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
 * Both sinks take whole-file CONTENTS: `openOrUpdateDraftPr` commits what it is given over the
 * contents API, and a suggestion comment is rendered into a `suggestion` block a reviewer can
 * commit with one click. So a `patch` recommendation is first APPLIED to the target file read
 * through `opts.fileAccessFor` — sending the diff text instead replaces the file with the diff.
 * A patch that cannot be read or does not apply is reported on the check run and in the draft-PR
 * body, and is never written.
 *
 * A summary check run is *always* posted to the source PR: `success` when there
 * was at least one recommendation, `neutral` otherwise.
 */
export async function publish(
  recs: Recommendation[],
  sourcePr: PrRef,
  gh: GitHubAccess,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const byRepo = new Map<RepoTarget, Recommendation[]>();
  for (const rec of recs) {
    const group = byRepo.get(rec.targetRepo) ?? [];
    group.push(rec);
    byRepo.set(rec.targetRepo, group);
  }

  const draftPrs: PublishResult['draftPrs'] = [];
  const unpublished: UnpublishedRecommendation[] = [];
  let selfSuggested = 0;
  // `self` is a link target, not a repo a reader can be built for: resolve it to the source repo.
  const sourceRepo = `${sourcePr.owner}/${sourcePr.repo}`;

  for (const [repo, group] of byRepo) {
    if (repo === 'self') {
      const files: { path: string; content: string }[] = [];
      for (const rec of group) {
        if (rec.action === 'remove') continue; // A deletion is not a content suggestion.
        const resolved = await contentsFor(rec, sourceRepo, opts);
        if (resolved.ok) files.push({ path: rec.path, content: resolved.content });
        else unpublished.push({ repo, path: rec.path, reason: resolved.reason });
      }
      if (files.length > 0) {
        await gh.addPrSuggestions(sourcePr, files, summarize(group));
        selfSuggested += files.length;
      }
      continue;
    }

    const files: { path: string; content: string | null }[] = [];
    for (const rec of group) {
      if (rec.action === 'remove') {
        files.push({ path: rec.path, content: null });
        continue;
      }
      const resolved = await contentsFor(rec, repo, opts);
      if (resolved.ok) files.push({ path: rec.path, content: resolved.content });
      else unpublished.push({ repo, path: rec.path, reason: resolved.reason });
    }
    if (files.length === 0) continue; // Nothing landed for this repo; an empty PR says nothing.

    const branch = syncBranchName(repo, sourcePr);
    const title = `Warden coverage sync — PR #${sourcePr.number}`;
    const result = await gh.openOrUpdateDraftPr(
      repo,
      branch,
      files,
      title,
      prBody(
        group,
        sourcePr,
        unpublished.filter((u) => u.repo === repo),
      ),
    );
    draftPrs.push({ repo, url: result.url, number: result.number });
  }

  const title = `Warden coverage sync — PR #${sourcePr.number}`;
  await gh.postCheckRun(
    sourcePr,
    recs.length > 0 ? 'success' : 'neutral',
    title,
    [summarize(recs), ...unpublishedLines(unpublished)].join('\n'),
  );

  return { draftPrs, selfSuggested, unpublished };
}

type ResolvedContent = { ok: true; content: string } | { ok: false; reason: string };

/**
 * The whole-file contents a recommendation proposes. `content` is already that; a `patch` is
 * applied to the target file as it stands, which needs a reader for that repo.
 */
async function contentsFor(
  rec: Recommendation,
  repo: RepoTarget,
  opts: PublishOptions,
): Promise<ResolvedContent> {
  if (rec.content !== undefined) return { ok: true, content: rec.content };
  if (rec.patch === undefined) {
    return { ok: false, reason: 'recommendation carries neither file contents nor a patch' };
  }
  if (!opts.fileAccessFor) {
    return {
      ok: false,
      reason: `patch could not be applied: no read access to ${repo} was supplied`,
    };
  }
  const original = await opts.fileAccessFor(repo).readFile(rec.path);
  if (original === null) {
    return { ok: false, reason: `patch could not be applied: ${rec.path} was not readable` };
  }
  const applied = applyUnifiedDiff(original, rec.patch);
  return applied.ok
    ? { ok: true, content: applied.content }
    : { ok: false, reason: `patch could not be applied: ${applied.reason}` };
}

/** One line per unpublished recommendation — a proposal Warden dropped is always stated. */
function unpublishedLines(unpublished: UnpublishedRecommendation[]): string[] {
  return unpublished.map((u) => `not published: ${u.repo} ${u.path} — ${u.reason}`);
}

/** A one-line-per-recommendation human summary, grouped by kind/action. */
function summarize(recs: Recommendation[]): string {
  if (recs.length === 0) return 'No recommendations.';
  const lines = recs.map(
    (rec) => `- ${rec.action} ${rec.kind}: ${rec.path} (${rec.targetRepo}) — ${rec.reason}`,
  );
  return lines.join('\n');
}

/** The draft-PR body for one target repo's recommendations, including any it could not publish. */
function prBody(
  recs: Recommendation[],
  sourcePr: PrRef,
  unpublished: UnpublishedRecommendation[] = [],
): string {
  return [
    `Proposed by Warden coverage sync from ${sourcePr.owner}/${sourcePr.repo}#${sourcePr.number}.`,
    '',
    summarize(recs),
    ...unpublishedLines(unpublished),
  ].join('\n');
}
