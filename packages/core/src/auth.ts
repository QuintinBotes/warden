/**
 * Enterprise auth contracts — the additive access-control surface Warden's two hosted
 * surfaces (the dashboard and the GitHub App) build on. Nothing here is required by the
 * self-hosted OSS core; `@warden/enterprise` implements these seams and the
 * `enterprise.auth.mode: 'none'` default keeps every surface auth-optional.
 *
 * Additive only — no existing `@warden/core` type or export changes.
 */

/** Warden's three roles, ordered `viewer < maintainer < admin`. */
export type Role = 'viewer' | 'maintainer' | 'admin';

/** A stable tenant reference — one org / GitHub installation in a hosted deployment. */
export interface TenantRef {
  id: string; // stable tenant id — derived from a GitHub installation id or SSO org domain
  name: string;
}

/** An authenticated user, resolved from a verified OIDC token. */
export interface Principal {
  subject: string; // OIDC `sub`
  email: string;
  tenant: TenantRef;
  roles: Role[];
}

/** Verifies a bearer/id token and resolves it to a {@link Principal}. */
export interface AuthProvider {
  verify(token: string): Promise<Principal>;
}

/** The audited events — the two the gap analysis calls out, plus login and role changes. */
export type AuditAction =
  'gate.override' | 'suggestion.merged' | 'suggestion.dismissed' | 'role.changed' | 'login';

export interface AuditEvent {
  id: string;
  at: Date;
  tenant: TenantRef;
  actor: { subject: string; email: string };
  action: AuditAction;
  resource: { type: string; id: string }; // e.g. { type: 'pull_request', id: 'org/repo#123' }
  detail: string;
  metadata?: Record<string, unknown>;
}

/** Append-only. No update/delete in the contract — compliance requires a durable trail. */
export interface AuditSink {
  record(event: Omit<AuditEvent, 'id' | 'at'>): Promise<AuditEvent>;
  query(filter: {
    tenant: TenantRef;
    from?: Date;
    to?: Date;
    action?: AuditAction;
  }): Promise<AuditEvent[]>;
}

/** Numeric rank so the `viewer < maintainer < admin` hierarchy is comparable. */
const ROLE_RANK: Record<Role, number> = { viewer: 0, maintainer: 1, admin: 2 };

/** True if any of `principal.roles` is at or above `required` in `viewer < maintainer < admin`. */
export function hasRole(principal: Principal, required: Role): boolean {
  const need = ROLE_RANK[required];
  return principal.roles.some((role) => ROLE_RANK[role] >= need);
}
