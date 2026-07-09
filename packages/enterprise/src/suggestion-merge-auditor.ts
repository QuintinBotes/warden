import type { AuditSink, PrRef, TenantRef } from '@warden/core';

/** Coverage-sync draft PRs open on `warden/sync-*` branches (see the coverage-sync proposal). */
const COVERAGE_SYNC_BRANCH_PREFIX = 'warden/sync-';

/** A closed pull request carrying the merge outcome the App's `pull_request` handler observes. */
export interface MergedPullRequest extends PrRef {
  merged: boolean;
  branch: string;
  mergedBy: { login: string; email?: string };
}

export interface SuggestionMergeAuditor {
  /** No-op unless the merged branch matches the coverage-sync prefix (`warden/sync-*`). */
  onPullRequestClosed(tenant: TenantRef, pr: MergedPullRequest): Promise<void>;
}

/**
 * Records a `suggestion.merged` audit event when a coverage-sync draft PR is actually merged.
 * A non-merged close, or a merge on any other branch, is a no-op.
 */
export function createSuggestionMergeAuditor(auditSink: AuditSink): SuggestionMergeAuditor {
  return {
    async onPullRequestClosed(tenant, pr): Promise<void> {
      if (!pr.merged) return;
      if (!pr.branch.startsWith(COVERAGE_SYNC_BRANCH_PREFIX)) return;
      await auditSink.record({
        tenant,
        actor: { subject: pr.mergedBy.login, email: pr.mergedBy.email ?? '' },
        action: 'suggestion.merged',
        resource: { type: 'pull_request', id: `${pr.owner}/${pr.repo}#${pr.number}` },
        detail: `merged coverage-sync suggestion on ${pr.branch}`,
        metadata: { branch: pr.branch },
      });
    },
  };
}
