import { describe, it, expect } from 'vitest';
import type { AuditEvent, AuditSink, TenantRef } from '@warden/core';
import { createSqliteAuditSink } from './sqlite-audit-sink.js';

const tenantA: TenantRef = { id: 'acme', name: 'Acme' };
const tenantB: TenantRef = { id: 'globex', name: 'Globex' };

function eventFor(
  tenant: TenantRef,
  overrides: Partial<Omit<AuditEvent, 'id' | 'at'>> = {},
): Omit<AuditEvent, 'id' | 'at'> {
  return {
    tenant,
    actor: { subject: 'user-1', email: 'user@acme.com' },
    action: 'gate.override',
    resource: { type: 'pull_request', id: 'acme/web#7' },
    detail: 'flaky infra, verified manually',
    ...overrides,
  };
}

describe('createSqliteAuditSink', () => {
  it('records then queries back one event (round-trip) against an in-memory db', async () => {
    const at = new Date('2026-07-01T12:00:00.000Z');
    const sink = createSqliteAuditSink(':memory:', { now: () => at });
    const recorded = await sink.record(
      eventFor(tenantA, { metadata: { previousDecision: 'BLOCK' } }),
    );

    expect(recorded.id).toMatch(/^audit-/);
    expect(recorded.at).toEqual(at);

    const found = await sink.query({ tenant: tenantA });
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual(recorded);
    expect(found[0]?.metadata).toEqual({ previousDecision: 'BLOCK' });
  });

  it('is idempotent for a re-recorded (same-content) event — no double logging', async () => {
    let clock = new Date('2026-07-01T12:00:00.000Z');
    const sink = createSqliteAuditSink(':memory:', { now: () => clock });
    const first = await sink.record(eventFor(tenantA));
    clock = new Date('2026-07-02T12:00:00.000Z'); // a later re-delivery
    const second = await sink.record(eventFor(tenantA));

    expect(second.id).toBe(first.id);
    expect(second.at).toEqual(first.at); // keeps the original timestamp
    expect(await sink.query({ tenant: tenantA })).toHaveLength(1);
  });

  it("never leaks one tenant's events into another tenant's query", async () => {
    const sink = createSqliteAuditSink(':memory:');
    await sink.record(eventFor(tenantA, { resource: { type: 'pull_request', id: 'acme/web#1' } }));
    await sink.record(
      eventFor(tenantB, { resource: { type: 'pull_request', id: 'globex/api#9' } }),
    );

    const forA = await sink.query({ tenant: tenantA });
    const forB = await sink.query({ tenant: tenantB });
    expect(forA.map((e) => e.tenant.id)).toEqual(['acme']);
    expect(forB.map((e) => e.tenant.id)).toEqual(['globex']);
  });

  it('filters by action and date range', async () => {
    const sink = createSqliteAuditSink(':memory:', {
      now: () => new Date('2026-07-05T00:00:00.000Z'),
    });
    await sink.record(
      eventFor(tenantA, { action: 'login', resource: { type: 'session', id: 's1' } }),
    );
    await sink.record(eventFor(tenantA, { action: 'gate.override' }));

    const overrides = await sink.query({ tenant: tenantA, action: 'gate.override' });
    expect(overrides.map((e) => e.action)).toEqual(['gate.override']);

    const before = await sink.query({ tenant: tenantA, to: new Date('2026-01-01T00:00:00.000Z') });
    expect(before).toEqual([]);
  });

  it('exposes no update or delete method (append-only by contract)', () => {
    // Type-level assertion: AuditSink has exactly `record` and `query`.
    type Keys = keyof AuditSink;
    const _onlyRecordAndQuery: Keys extends 'record' | 'query' ? true : false = true;
    expect(_onlyRecordAndQuery).toBe(true);
  });
});
