import Database from 'better-sqlite3';
import { contentId, type AuditAction, type AuditEvent, type AuditSink } from '@warden/core';

/** Storage row shape for one audit event (dates as ISO strings, metadata as JSON). */
interface AuditRow {
  id: string;
  at: string;
  tenantId: string;
  tenantName: string;
  actorSubject: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  detail: string;
  metadata: string | null;
}

export interface SqliteAuditSinkOptions {
  /** Injected clock so the recorded `at` is deterministic in tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Content-derived id so re-processing the same webhook delivery (GitHub's at-least-once
 * delivery) is idempotent rather than double-logged. Deliberately excludes `at` — a re-record
 * of the same logical event collapses to the first row, keeping its original timestamp.
 */
function auditId(event: Omit<AuditEvent, 'id' | 'at'>): string {
  return contentId(
    'audit',
    [
      event.tenant.id,
      event.action,
      event.resource.type,
      event.resource.id,
      event.actor.subject,
      event.detail,
    ].join('|'),
  );
}

/**
 * Append-only, `better-sqlite3`-backed {@link AuditSink}. Pass a file path for durability or
 * `':memory:'` for a hermetic test. Exposes only `record` / `query` — no update or delete, so
 * the compliance trail is durable by construction.
 */
export function createSqliteAuditSink(
  dbPath: string,
  opts: SqliteAuditSinkOptions = {},
): AuditSink {
  const now = opts.now ?? ((): Date => new Date());
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      tenantId TEXT NOT NULL,
      tenantName TEXT NOT NULL,
      actorSubject TEXT NOT NULL,
      actorEmail TEXT NOT NULL,
      action TEXT NOT NULL,
      resourceType TEXT NOT NULL,
      resourceId TEXT NOT NULL,
      detail TEXT NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events (tenantId, at);
  `);

  function rowToEvent(row: AuditRow): AuditEvent {
    const event: AuditEvent = {
      id: row.id,
      at: new Date(row.at),
      tenant: { id: row.tenantId, name: row.tenantName },
      actor: { subject: row.actorSubject, email: row.actorEmail },
      action: row.action as AuditAction,
      resource: { type: row.resourceType, id: row.resourceId },
      detail: row.detail,
    };
    if (row.metadata != null) {
      event.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    }
    return event;
  }

  const selectById = db.prepare('SELECT * FROM audit_events WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO audit_events
      (id, at, tenantId, tenantName, actorSubject, actorEmail, action, resourceType, resourceId, detail, metadata)
    VALUES
      (@id, @at, @tenantId, @tenantName, @actorSubject, @actorEmail, @action, @resourceType, @resourceId, @detail, @metadata)
    ON CONFLICT(id) DO NOTHING
  `);

  return {
    async record(event): Promise<AuditEvent> {
      const id = auditId(event);
      const existing = selectById.get(id) as AuditRow | undefined;
      if (existing) return rowToEvent(existing);
      insert.run({
        id,
        at: now().toISOString(),
        tenantId: event.tenant.id,
        tenantName: event.tenant.name,
        actorSubject: event.actor.subject,
        actorEmail: event.actor.email,
        action: event.action,
        resourceType: event.resource.type,
        resourceId: event.resource.id,
        detail: event.detail,
        metadata: event.metadata != null ? JSON.stringify(event.metadata) : null,
      });
      return rowToEvent(selectById.get(id) as AuditRow);
    },

    async query(filter): Promise<AuditEvent[]> {
      const clauses = ['tenantId = ?'];
      const params: string[] = [filter.tenant.id];
      if (filter.from) {
        clauses.push('at >= ?');
        params.push(filter.from.toISOString());
      }
      if (filter.to) {
        clauses.push('at <= ?');
        params.push(filter.to.toISOString());
      }
      if (filter.action) {
        clauses.push('action = ?');
        params.push(filter.action);
      }
      const rows = db
        .prepare(
          `SELECT * FROM audit_events WHERE ${clauses.join(' AND ')} ORDER BY at ASC, id ASC`,
        )
        .all(...params) as AuditRow[];
      return rows.map(rowToEvent);
    },
  };
}
