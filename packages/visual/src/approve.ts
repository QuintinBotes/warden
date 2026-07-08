import type {
  DraftPrResult,
  GitHubAccess,
  RepoTarget,
  VisualBaseline,
  VisualBaselineKey,
  VisualBaselineStore,
} from '@warden/core';

/** Options for committing an approved baseline back to a repo. */
export interface ApproveBaselineOptions {
  /** Target repo for the commit; defaults to `'self'` (the PR's own repo). */
  repo?: RepoTarget;
  /** Branch the baseline commit lands on; defaults to a deterministic per-key branch. */
  branch?: string;
  /** Draft-PR title. */
  title?: string;
  /** Draft-PR body. */
  body?: string;
}

/** Outcome of {@link approveBaseline}. */
export interface ApproveBaselineResult {
  baseline: VisualBaseline;
  committed: boolean;
  draftPr?: DraftPrResult;
}

/** Branch name for an approved baseline commit — stable per key so re-approvals reuse the branch. */
export function approveBranchName(key: VisualBaselineKey): string {
  const clean = (s: string): string => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `warden/visual-approve/${clean(key.module)}-${clean(key.viewport)}-${key.theme}`;
}

/**
 * Promotes a pending candidate to the committed baseline, recording `approvedBy` (and, via the
 * store, `approvedAt` + `sourceSha`) for the audit trail. When an injected `GitHubAccess` is
 * supplied, the promoted baseline PNG is committed on a draft PR (bytes base64-encoded into the
 * file payload). Baselines are never auto-approved: this is the single explicit promotion path
 * behind the CLI, the PR command, and the dashboard button.
 */
export async function approveBaseline(
  key: VisualBaselineKey,
  approvedBy: string,
  store: VisualBaselineStore,
  gh?: GitHubAccess,
  opts: ApproveBaselineOptions = {},
): Promise<ApproveBaselineResult> {
  const baseline = await store.approve(key, approvedBy);

  if (!gh) {
    return { baseline, committed: false };
  }

  const bytes = await store.read(baseline);
  const repo = opts.repo ?? 'self';
  const branch = opts.branch ?? approveBranchName(key);
  const title =
    opts.title ?? `Approve visual baseline: ${key.module} (${key.viewport}/${key.theme})`;
  const body =
    opts.body ??
    `Approved by ${approvedBy}. Promotes the pending candidate to the committed baseline for ` +
      `\`${key.module}\` at \`${key.viewport}\`/\`${key.theme}\`.`;

  const draftPr = await gh.openOrUpdateDraftPr(
    repo,
    branch,
    [{ path: baseline.path, content: Buffer.from(bytes).toString('base64') }],
    title,
    body,
  );

  return { baseline, committed: true, draftPr };
}
