import {
  contentId,
  type AuditEvent,
  type AuditSink,
  type AuthProvider,
  type Principal,
} from '@warden/core';

/**
 * The `mode: 'none'` defaults. Following the `NoopMetricsEmitter` pattern in
 * `@warden/observability`, the "off" state is a real, fully-typed implementation — not a branch
 * scattered through calling code, and never a fallback reached by catching an error.
 */

/** The single implicit admin principal `openAuthProvider` resolves every token to. */
export const OPEN_ADMIN_PRINCIPAL: Principal = {
  subject: 'warden-open',
  email: '',
  tenant: { id: 'local', name: 'Local' },
  roles: ['admin'],
};

/** Resolves every token to a single implicit admin principal — the auth-optional self-hosted default. */
export const openAuthProvider: AuthProvider = {
  async verify(_token: string): Promise<Principal> {
    return {
      subject: OPEN_ADMIN_PRINCIPAL.subject,
      email: OPEN_ADMIN_PRINCIPAL.email,
      tenant: { ...OPEN_ADMIN_PRINCIPAL.tenant },
      roles: [...OPEN_ADMIN_PRINCIPAL.roles],
    };
  },
};

/** Accepts records without persisting them and always queries empty — no audit trail is kept. */
export const noopAuditSink: AuditSink = {
  async record(event): Promise<AuditEvent> {
    return {
      ...event,
      id: contentId('audit', [event.tenant.id, event.action, event.resource.id].join('|')),
      at: new Date(),
    };
  },
  async query(): Promise<AuditEvent[]> {
    return [];
  },
};
