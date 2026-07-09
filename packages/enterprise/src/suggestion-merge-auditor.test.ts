import { describe, it, expect } from 'vitest';
import type { AuditEvent, AuditSink, TenantRef } from '@warden/core';
import {
  createSuggestionMergeAuditor,
  type MergedPullRequest,
} from './suggestion-merge-auditor.js';

const tenant: TenantRef = { id: 'acme', name: 'Acme' };

function recordingSink() {
  const recorded: Array<Omit<AuditEvent, 'id' | 'at'>> = [];
  const sink: AuditSink = {
    async record(event): Promise<AuditEvent> {
      recorded.push(event);
      return { ...event, id: 'audit-test', at: new Date('2026-07-01T00:00:00.000Z') };
    },
    async query() {
      return [];
    },
  };
  return { sink, recorded };
}

function mergedPr(overrides: Partial<MergedPullRequest> = {}): MergedPullRequest {
  return {
    owner: 'acme',
    repo: 'web',
    number: 42,
    headSha: 'abc',
    headRef: 'warden/sync-service-checkout-pr-42',
    merged: true,
    branch: 'warden/sync-service-checkout-pr-42',
    mergedBy: { login: 'octocat', email: 'octo@acme.com' },
    ...overrides,
  };
}

describe('createSuggestionMergeAuditor', () => {
  it('records suggestion.merged for a merged warden/sync-* branch', async () => {
    const { sink, recorded } = recordingSink();
    await createSuggestionMergeAuditor(sink).onPullRequestClosed(tenant, mergedPr());
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: 'suggestion.merged',
      actor: { subject: 'octocat', email: 'octo@acme.com' },
      resource: { type: 'pull_request', id: 'acme/web#42' },
    });
  });

  it('no-ops when the PR was closed without merging', async () => {
    const { sink, recorded } = recordingSink();
    await createSuggestionMergeAuditor(sink).onPullRequestClosed(
      tenant,
      mergedPr({ merged: false }),
    );
    expect(recorded).toHaveLength(0);
  });

  it('no-ops on a merge of an unrelated branch', async () => {
    const { sink, recorded } = recordingSink();
    await createSuggestionMergeAuditor(sink).onPullRequestClosed(
      tenant,
      mergedPr({ branch: 'feature/checkout', headRef: 'feature/checkout' }),
    );
    expect(recorded).toHaveLength(0);
  });
});
