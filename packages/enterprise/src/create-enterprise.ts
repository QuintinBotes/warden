import {
  ConfigError,
  type AuditSink,
  type AuthProvider,
  type GitHubAccess,
  type Principal,
  type Role,
  type TenantRef,
  type WardenConfig,
} from '@warden/core';
import { createOidcAuthProvider, type JwksFetcher } from './oidc-auth-provider.js';
import type { RoleMapping } from './role-mapper.js';
import { createSqliteAuditSink } from './sqlite-audit-sink.js';
import { createGateOverrideHandler, type GateOverrideHandler } from './gate-override-handler.js';
import {
  createSuggestionMergeAuditor,
  type SuggestionMergeAuditor,
} from './suggestion-merge-auditor.js';
import { requireRole } from './rbac-guard.js';
import { noopAuditSink, openAuthProvider } from './noop.js';

/** OIDC deployment secrets/config — supplied from `deploy/.env`, never from `warden.config.ts`. */
export interface OidcDeploymentConfig {
  issuer: string;
  audience: string;
  jwks: JwksFetcher;
  resolveTenant: (claims: Record<string, unknown>) => TenantRef;
  roleMapping: (tenant: TenantRef) => RoleMapping;
  clockSkewToleranceSeconds?: number;
}

export interface CreateEnterpriseDeps {
  /** Required when `cfg.enterprise.auth.mode === 'oidc'`. */
  oidc?: OidcDeploymentConfig;
  /** Required when audit is effectively enabled. `':memory:'` is accepted for tests. */
  auditDbPath?: string;
  /** Injected clock for the audit sink. */
  now?: () => Date;
}

/** The wired enterprise surface for one deployment. */
export interface Enterprise {
  readonly mode: 'none' | 'oidc';
  readonly auditEnabled: boolean;
  readonly authProvider: AuthProvider;
  readonly auditSink: AuditSink;
  requireRole(principal: Principal, required: Role): void;
  createGateOverrideHandler(gh: GitHubAccess): GateOverrideHandler;
  createSuggestionMergeAuditor(): SuggestionMergeAuditor;
}

/**
 * Wires the enterprise surface from `cfg.enterprise`. When `auth.mode === 'none'` everything is a
 * permissive no-op ({@link openAuthProvider} + {@link noopAuditSink}, override gated at `viewer`),
 * so the self-hosted OSS core is unaffected. When `auth.mode === 'oidc'` it refuses to start
 * (throws {@link ConfigError}) if the OIDC deployment config is missing — it never silently falls
 * back to the open default.
 */
export function createEnterprise(cfg: WardenConfig, deps: CreateEnterpriseDeps = {}): Enterprise {
  const mode = cfg.enterprise.auth.mode;
  // audit is auto-on when auth is on, or can be forced on independently.
  const auditEnabled = cfg.enterprise.audit.enabled || mode !== 'none';

  let authProvider: AuthProvider;
  if (mode === 'oidc') {
    if (!deps.oidc) {
      throw new ConfigError(
        'enterprise.auth.mode is "oidc" but the OIDC deployment configuration was not provided',
      );
    }
    authProvider = createOidcAuthProvider(deps.oidc);
  } else {
    authProvider = openAuthProvider;
  }

  let auditSink: AuditSink;
  if (auditEnabled) {
    if (!deps.auditDbPath) {
      throw new ConfigError('enterprise audit is enabled but no `auditDbPath` was provided');
    }
    auditSink = createSqliteAuditSink(deps.auditDbPath, { now: deps.now });
  } else {
    auditSink = noopAuditSink;
  }

  // In the self-hosted default the override is permissive: openAuthProvider already resolves an
  // admin principal, so a 'viewer' floor means the override still works, just isn't role-gated.
  const gateOverrideRole: Role =
    mode === 'none' ? 'viewer' : cfg.enterprise.auth.requiredRoleForGateOverride;

  return {
    mode,
    auditEnabled,
    authProvider,
    auditSink,
    requireRole,
    createGateOverrideHandler(gh: GitHubAccess): GateOverrideHandler {
      return createGateOverrideHandler({ requiredRole: gateOverrideRole, auditSink, gh });
    },
    createSuggestionMergeAuditor(): SuggestionMergeAuditor {
      return createSuggestionMergeAuditor(auditSink);
    },
  };
}
