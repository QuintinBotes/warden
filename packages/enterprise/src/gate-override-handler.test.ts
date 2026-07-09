import { describe, it, expect } from 'vitest';
import type {
  AuditEvent,
  AuditSink,
  GateDecision,
  GitHubAccess,
  Principal,
  PrRef,
  Role,
} from '@warden/core';
import { createGateOverrideHandler } from './gate-override-handler.js';
import { AuthzError } from './rbac-guard.js';

const pr: PrRef = { owner: 'acme', repo: 'web', number: 42, headSha: 'abc123', headRef: 'feature' };
const blockDecision: GateDecision = { decision: 'BLOCK', reason: 'pass rate below 90%' };

function principal(roles: Role[]): Principal {
  return {
    subject: 'user-123',
    email: 'dev@acme.com',
    tenant: { id: 'acme', name: 'Acme' },
    roles,
  };
}

interface CheckRunCall {
  conclusion: 'success' | 'neutral' | 'failure';
}

function fakes() {
  const checkRuns: CheckRunCall[] = [];
  const recorded: Array<Omit<AuditEvent, 'id' | 'at'>> = [];
  const gh: GitHubAccess = {
    async openOrUpdateDraftPr() {
      return { url: '', number: 0 };
    },
    async addPrSuggestions() {},
    async postCheckRun(_pr, conclusion) {
      checkRuns.push({ conclusion });
    },
  };
  const auditSink: AuditSink = {
    async record(event): Promise<AuditEvent> {
      recorded.push(event);
      return { ...event, id: 'audit-test', at: new Date('2026-07-01T00:00:00.000Z') };
    },
    async query() {
      return [];
    },
  };
  return { gh, auditSink, checkRuns, recorded };
}

describe('createGateOverrideHandler', () => {
  it('a viewer is rejected with AuthzError and produces zero side effects', async () => {
    const { gh, auditSink, checkRuns, recorded } = fakes();
    const handler = createGateOverrideHandler({ requiredRole: 'maintainer', auditSink, gh });

    await expect(
      handler.override({
        principal: principal(['viewer']),
        pr,
        decision: blockDecision,
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(AuthzError);

    expect(checkRuns).toHaveLength(0); // fail-closed: nothing before the role check
    expect(recorded).toHaveLength(0);
  });

  it('a maintainer flips the check-run, records the override, and amends the decision', async () => {
    const { gh, auditSink, checkRuns, recorded } = fakes();
    const handler = createGateOverrideHandler({ requiredRole: 'maintainer', auditSink, gh });

    const amended = await handler.override({
      principal: principal(['maintainer']),
      pr,
      decision: blockDecision,
      reason: 'flaky infra, verified manually',
    });

    expect(amended.overridden).toBe(true);
    expect(amended.overriddenBy).toBe('user-123');
    expect(amended.overrideReason).toBe('flaky infra, verified manually');
    expect(amended.decision).toBe('BLOCK'); // original preserved for the trail

    expect(checkRuns).toEqual([{ conclusion: 'success' }]); // exactly one flip to success

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: 'gate.override',
      actor: { subject: 'user-123', email: 'dev@acme.com' },
      resource: { type: 'pull_request', id: 'acme/web#42' },
      detail: 'flaky infra, verified manually',
    });
  });
});
