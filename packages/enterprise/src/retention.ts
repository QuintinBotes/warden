import type { AuditEvent } from '@warden/core';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The audit events a retention job should purge: those older than `retentionDays` before `now`.
 * Pure — takes an explicit `now` so the cutoff is deterministically testable without a real
 * clock or database. An event exactly at the cutoff is kept (strictly-older is purged).
 */
export function purgeableAuditEvents(
  events: AuditEvent[],
  retentionDays: number,
  now: Date,
): AuditEvent[] {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  return events.filter((event) => event.at.getTime() < cutoff);
}
