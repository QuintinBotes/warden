import { describe, it, expect } from 'vitest';
import type { GateDecision, Principal, PrRef } from '@warden/core';
import { AuthzError, type GateOverrideHandler } from '@warden/enterprise';
import {
  handleOverrideComment,
  parseOverrideCommand,
  type IssueCommentEvent,
} from './comment-webhook.js';

const pr: PrRef = { owner: 'acme', repo: 'web', number: 7, headSha: 'abc', headRef: 'feat' };
const block: GateDecision = { decision: 'BLOCK', reason: 'pass rate below 90%' };

function principal(roles: Principal['roles']): Principal {
  return { subject: 'user-1', email: 'dev@acme.com', tenant: { id: 'acme', name: 'Acme' }, roles };
}

function commentEvent(overrides: {
  action?: string;
  body?: string;
  isPr?: boolean;
  login?: string;
}): IssueCommentEvent {
  return {
    action: overrides.action ?? 'created',
    installation: { id: 1 },
    repository: { name: 'web', full_name: 'acme/web', owner: { login: 'acme' } },
    issue: {
      number: 7,
      pull_request: (overrides.isPr ?? true) ? { url: 'https://api/pr/7' } : null,
    },
    comment: {
      body: overrides.body ?? '/warden override: flaky infra, verified manually',
      user: { login: overrides.login ?? 'octocat' },
    },
  };
}

interface Harness {
  overrideCalls: number;
  replies: string[];
}

function deps(opts: {
  event: IssueCommentEvent;
  principal: Principal | null;
  overrideImpl?: GateOverrideHandler['override'];
  harness: Harness;
}) {
  const overrideHandler: GateOverrideHandler = {
    override:
      opts.overrideImpl ??
      (async ({ decision, principal: p, reason }) => {
        opts.harness.overrideCalls += 1;
        return { ...decision, overridden: true, overriddenBy: p.subject, overrideReason: reason };
      }),
  };
  return {
    event: opts.event,
    overrideHandler,
    resolvePrincipal: async () => opts.principal,
    loadPrRef: async () => pr,
    loadGateDecision: async () => block,
    reply: async (_loc: unknown, message: string) => {
      opts.harness.replies.push(message);
    },
  };
}

describe('parseOverrideCommand', () => {
  it('parses both `/warden override <reason>` and `/warden override: <reason>`', () => {
    expect(parseOverrideCommand('/warden override flaky infra')).toBe('flaky infra');
    expect(parseOverrideCommand('/warden override: flaky infra')).toBe('flaky infra');
  });
  it('returns null for unrelated comments', () => {
    expect(parseOverrideCommand('lgtm, merging')).toBeNull();
    expect(parseOverrideCommand('/warden override')).toBeNull(); // needs a reason
  });
});

describe('handleOverrideComment', () => {
  it('overrides for a bound maintainer principal', async () => {
    const harness: Harness = { overrideCalls: 0, replies: [] };
    const result = await handleOverrideComment(
      deps({ event: commentEvent({}), principal: principal(['maintainer']), harness }),
    );
    expect(result.outcome).toBe('overridden');
    expect(result.decision?.overridden).toBe(true);
    expect(harness.overrideCalls).toBe(1);
    expect(harness.replies).toEqual([]);
  });

  it('replies and refuses when the commenter is unbound (no dashboard login)', async () => {
    const harness: Harness = { overrideCalls: 0, replies: [] };
    const result = await handleOverrideComment(
      deps({ event: commentEvent({}), principal: null, harness }),
    );
    expect(result.outcome).toBe('unbound-identity');
    expect(harness.overrideCalls).toBe(0);
    expect(harness.replies[0]).toMatch(/sign in to the warden dashboard/i);
  });

  it('replies with an access message when the handler throws AuthzError', async () => {
    const harness: Harness = { overrideCalls: 0, replies: [] };
    const result = await handleOverrideComment(
      deps({
        event: commentEvent({}),
        principal: principal(['viewer']),
        overrideImpl: async () => {
          throw new AuthzError('maintainer', ['viewer']);
        },
        harness,
      }),
    );
    expect(result.outcome).toBe('forbidden');
    expect(harness.replies[0]).toMatch(/need `maintainer` access/i);
  });

  it('ignores non-created actions, plain issues, and non-command comments', async () => {
    const harness: Harness = { overrideCalls: 0, replies: [] };
    const edited = await handleOverrideComment(
      deps({ event: commentEvent({ action: 'edited' }), principal: principal(['admin']), harness }),
    );
    expect(edited.outcome).toBe('ignored');

    const issue = await handleOverrideComment(
      deps({ event: commentEvent({ isPr: false }), principal: principal(['admin']), harness }),
    );
    expect(issue.outcome).toBe('not-a-pull-request');

    const chatter = await handleOverrideComment(
      deps({ event: commentEvent({ body: 'lgtm' }), principal: principal(['admin']), harness }),
    );
    expect(chatter.outcome).toBe('no-command');

    expect(harness.overrideCalls).toBe(0);
  });
});
