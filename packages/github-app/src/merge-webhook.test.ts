import { describe, it, expect } from 'vitest';
import type { TenantRef } from '@warden/core';
import type { MergedPullRequest, SuggestionMergeAuditor } from '@warden/enterprise';
import { handleMergeClose, type PullRequestClosedEvent } from './merge-webhook.js';

const tenant: TenantRef = { id: 'acme', name: 'Acme' };

function closedEvent(overrides: {
  action?: string;
  merged?: boolean;
  ref?: string;
}): PullRequestClosedEvent {
  return {
    action: overrides.action ?? 'closed',
    installation: { id: 1 },
    repository: { name: 'web', full_name: 'acme/web', owner: { login: 'acme' } },
    pull_request: {
      number: 42,
      merged: overrides.merged ?? true,
      head: { sha: 'abc', ref: overrides.ref ?? 'warden/sync-service-checkout-pr-42' },
      merged_by: { login: 'octocat', email: 'octo@acme.com' },
    },
  };
}

function recordingAuditor() {
  const calls: MergedPullRequest[] = [];
  const auditor: SuggestionMergeAuditor = {
    async onPullRequestClosed(_tenant, pr) {
      calls.push(pr);
    },
  };
  return { auditor, calls };
}

describe('handleMergeClose', () => {
  it('forwards a closed PR to the auditor with the merge outcome and branch', async () => {
    const { auditor, calls } = recordingAuditor();
    await handleMergeClose({ event: closedEvent({}), auditor, resolveTenant: () => tenant });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      owner: 'acme',
      repo: 'web',
      number: 42,
      merged: true,
      branch: 'warden/sync-service-checkout-pr-42',
      mergedBy: { login: 'octocat', email: 'octo@acme.com' },
    });
  });

  it('ignores non-closed actions (never calls the auditor)', async () => {
    const { auditor, calls } = recordingAuditor();
    await handleMergeClose({
      event: closedEvent({ action: 'opened' }),
      auditor,
      resolveTenant: () => tenant,
    });
    expect(calls).toEqual([]);
  });

  it('still forwards non-sync-branch and non-merged closes (the auditor decides to no-op)', async () => {
    const { auditor, calls } = recordingAuditor();
    await handleMergeClose({
      event: closedEvent({ merged: false, ref: 'feature/x' }),
      auditor,
      resolveTenant: () => tenant,
    });
    // The handler forwards; the SuggestionMergeAuditor itself applies the merged/prefix no-op rules.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.merged).toBe(false);
  });
});
