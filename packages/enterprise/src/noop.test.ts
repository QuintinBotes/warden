import { describe, it, expect } from 'vitest';
import type { TenantRef } from '@warden/core';
import { noopAuditSink, openAuthProvider } from './noop.js';

describe('openAuthProvider', () => {
  it('resolves every token to an implicit admin principal (never rejects)', async () => {
    const principal = await openAuthProvider.verify('anything-at-all');
    expect(principal.roles).toEqual(['admin']);
    expect(principal.subject).toBe('warden-open');
  });

  it('returns a fresh principal each call (no shared mutable state)', async () => {
    const a = await openAuthProvider.verify('t1');
    const b = await openAuthProvider.verify('t2');
    a.roles.push('viewer');
    expect(b.roles).toEqual(['admin']);
  });
});

describe('noopAuditSink', () => {
  const tenant: TenantRef = { id: 'acme', name: 'Acme' };

  it('accepts a record without persisting it and always queries empty', async () => {
    const recorded = await noopAuditSink.record({
      tenant,
      actor: { subject: 's', email: 'e@x.com' },
      action: 'gate.override',
      resource: { type: 'pull_request', id: 'acme/web#1' },
      detail: 'x',
    });
    expect(recorded.id).toMatch(/^audit-/);
    expect(await noopAuditSink.query({ tenant })).toEqual([]);
  });
});
