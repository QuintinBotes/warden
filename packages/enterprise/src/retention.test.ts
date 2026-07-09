import { describe, it, expect } from 'vitest';
import type { AuditEvent } from '@warden/core';
import { purgeableAuditEvents } from './retention.js';

function event(id: string, at: string): AuditEvent {
  return {
    id,
    at: new Date(at),
    tenant: { id: 'acme', name: 'Acme' },
    actor: { subject: 's', email: 'e@x.com' },
    action: 'login',
    resource: { type: 'session', id: 's1' },
    detail: '',
  };
}

describe('purgeableAuditEvents', () => {
  it('returns exactly the events older than the retention window (pure, fixed now)', () => {
    const now = new Date('2026-07-09T00:00:00.000Z'); // cutoff at 30 days = 2026-06-09
    const events = [
      event('old-1', '2025-01-01T00:00:00.000Z'), // ~554 days old -> purge
      event('old-2', '2026-06-01T00:00:00.000Z'), // ~38 days old -> purge
      event('recent', '2026-06-20T00:00:00.000Z'), // ~19 days old -> keep
      event('fresh', '2026-07-08T00:00:00.000Z'), // 1 day old -> keep
    ];
    const purgeable = purgeableAuditEvents(events, 30, now);
    expect(purgeable.map((e) => e.id)).toEqual(['old-1', 'old-2']);
  });

  it('keeps an event exactly at the cutoff (strictly-older is purged)', () => {
    const now = new Date('2026-07-31T00:00:00.000Z');
    const atCutoff = event('at-cutoff', '2026-07-01T00:00:00.000Z'); // exactly 30 days
    const justPast = event('just-past', '2026-06-30T23:59:59.000Z');
    const purgeable = purgeableAuditEvents([atCutoff, justPast], 30, now);
    expect(purgeable.map((e) => e.id)).toEqual(['just-past']);
  });

  it('returns nothing when every event is within retention', () => {
    const now = new Date('2026-07-09T00:00:00.000Z');
    const events = [event('a', '2026-07-08T00:00:00.000Z'), event('b', '2026-07-01T00:00:00.000Z')];
    expect(purgeableAuditEvents(events, 400, now)).toEqual([]);
  });
});
