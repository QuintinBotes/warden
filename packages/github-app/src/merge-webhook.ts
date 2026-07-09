import type { TenantRef } from '@warden/core';
import type { MergedPullRequest, SuggestionMergeAuditor } from '@warden/enterprise';

/**
 * The slice of a `pull_request` (`closed`) webhook payload the merge auditor reads. The real
 * `@octokit/webhooks` payload is a superset, so it is assignable to this shape.
 */
export interface PullRequestClosedEvent {
  action: string;
  installation?: { id: number };
  repository: {
    name: string;
    full_name: string;
    owner: { login: string };
  };
  pull_request: {
    number: number;
    merged: boolean;
    head: { sha: string; ref: string };
    merged_by?: { login: string; email?: string } | null;
  };
}

export interface HandleMergeCloseDeps {
  event: PullRequestClosedEvent;
  /** Injected from `@warden/enterprise` (`createSuggestionMergeAuditor`). */
  auditor: SuggestionMergeAuditor;
  /** Resolve the tenant for this event (e.g. from `event.installation.id`). */
  resolveTenant: (event: PullRequestClosedEvent) => TenantRef;
}

/**
 * Handle a `pull_request` (`closed`) event by handing it to the injected
 * {@link SuggestionMergeAuditor}, which records a `suggestion.merged` audit event iff the PR was
 * merged from a `warden/sync-*` branch (and no-ops otherwise). Non-`closed` actions are ignored.
 */
export async function handleMergeClose(deps: HandleMergeCloseDeps): Promise<void> {
  const { event } = deps;
  if (event.action !== 'closed') return;

  const tenant = deps.resolveTenant(event);
  const pr: MergedPullRequest = {
    owner: event.repository.owner.login,
    repo: event.repository.name,
    number: event.pull_request.number,
    headSha: event.pull_request.head.sha,
    headRef: event.pull_request.head.ref,
    merged: event.pull_request.merged,
    branch: event.pull_request.head.ref,
    mergedBy: {
      login: event.pull_request.merged_by?.login ?? 'unknown',
      ...(event.pull_request.merged_by?.email ? { email: event.pull_request.merged_by.email } : {}),
    },
  };
  await deps.auditor.onPullRequestClosed(tenant, pr);
}
