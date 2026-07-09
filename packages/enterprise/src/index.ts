/**
 * `@warden/enterprise` — enterprise readiness for Warden's two hosted surfaces (the dashboard
 * and the GitHub App): OIDC auth, RBAC, an append-only audit log, and per-tenant store
 * isolation. Hosted-only — nothing in `@warden/cli` or `warden-action` imports it, and the
 * `enterprise.auth.mode: 'none'` default keeps the self-hosted OSS core auth-optional.
 */

// OIDC auth over an injected JWKS fetcher.
export { createOidcAuthProvider, OidcVerificationError } from './oidc-auth-provider.js';
export type { JwksFetcher, OidcAuthProviderOptions, RoleMapping } from './oidc-auth-provider.js';

// Pure claims -> roles mapping.
export { mapClaimsToRoles } from './role-mapper.js';

// RBAC guard.
export { requireRole, AuthzError } from './rbac-guard.js';

// Append-only audit sink.
export { createSqliteAuditSink } from './sqlite-audit-sink.js';
export type { SqliteAuditSinkOptions } from './sqlite-audit-sink.js';

// Per-tenant store isolation.
export { createTenantStoreRegistry } from './tenant-store-registry.js';
export type {
  TenantStoreRegistry,
  CreateTenantStoreRegistryOptions,
} from './tenant-store-registry.js';
export { withTenantScope, TenantScopeError } from './with-tenant-scope.js';
export type { TenantScopedDashboardApi } from './with-tenant-scope.js';

// Gate override + suggestion-merge audit.
export { createGateOverrideHandler } from './gate-override-handler.js';
export type {
  GateOverrideHandler,
  GateOverrideHandlerDeps,
  GateOverrideInput,
} from './gate-override-handler.js';
export { createSuggestionMergeAuditor } from './suggestion-merge-auditor.js';
export type { SuggestionMergeAuditor, MergedPullRequest } from './suggestion-merge-auditor.js';

// Retention (pure cutoff logic).
export { purgeableAuditEvents } from './retention.js';

// `mode: 'none'` defaults.
export { noopAuditSink, openAuthProvider, OPEN_ADMIN_PRINCIPAL } from './noop.js';

// Factory that wires everything from `cfg.enterprise`.
export { createEnterprise } from './create-enterprise.js';
export type {
  Enterprise,
  CreateEnterpriseDeps,
  OidcDeploymentConfig,
} from './create-enterprise.js';
