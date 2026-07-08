# Proposal: Enterprise Readiness — SSO, RBAC, Audit, Multi-tenant

- Status: Draft (design proposal) · Date: 2026-07-08 · Relates to: warden-next-competitive-gaps.md §2.6

## Summary

This proposal adds an auth model to Warden's two **hosted** surfaces — the dashboard
(`apps/dashboard` + `@warden/dashboard-api`) and the GitHub App (`@warden/github-app`,
coverage-sync) — without touching the self-hosted OSS core. A new `@warden/enterprise`
package adds OIDC login, three roles (viewer/maintainer/admin), an append-only audit log of
gate overrides and coverage-sync suggestion merges, and per-tenant data isolation. Everything
is additive: new optional types in `@warden/core`, a `Noop`-style default that keeps
self-hosted deployments exactly as they are today, and an `enterprise.auth.mode` config flag
that is `'none'` unless an operator opts in.

## Motivation

§2.6 of the gap analysis notes that mabl, Testim, BrowserStack, and Sauce all ship
SSO/SAML/SCIM, RBAC, and audit logs, and that this is "required to sell to / run inside most
enterprises" — while "Warden's hosted dashboard + GitHub App have no auth model yet." Today
anyone who can reach the dashboard or the App's webhook-triggered surfaces sees every repo's
data with no login, no role distinction, and no record of who overrode a blocked gate or
merged a coverage-sync suggestion. That is fine for a single-repo, single-team self-hosted
install, but it blocks two things: (1) selling/operating a multi-team or multi-org hosted
deployment, and (2) §2.5's production-traffic recording, which the gap analysis explicitly
calls out as needing "a documented data-handling/retention posture" first. This proposal is
that prerequisite.

## Goals

1. OIDC login for the hosted dashboard and GitHub App admin surfaces, with no changes required
   to the self-hosted CLI/Action.
2. Three roles — `viewer` (read dashboard/reports), `maintainer` (override gates, merge/dismiss
   coverage-sync suggestions), `admin` (manage roles, tenant/SSO settings) — enforced at every
   write path that currently has none.
3. An append-only audit log of the two events the gap analysis calls out: gate overrides and
   coverage-sync suggestion merges, plus login and role-change events, queryable per tenant.
4. Tenant isolation: one hosted deployment can serve multiple orgs/installations without any
   cross-tenant data leakage, using Warden's existing per-repo SQLite stores rather than a new
   database engine.
5. A documented data-handling/retention posture (what is stored, for how long) that §2.5 can
   build on.
6. Keep the self-hosted OSS core (`cli`, `warden-action`, a locally-run dashboard) fully
   auth-optional — zero new required dependencies or config for that path.

## Non-Goals

- Full SCIM user/group provisioning (auto de/provisioning from the IdP). This version maps
  IdP claims/groups to roles at login time only; SCIM sync is future work.
- SAML. OIDC only, matching how most modern IdPs (Okta, Entra ID, Google Workspace) federate.
- A SOC 2 audit itself — this proposal is the access-control/audit-trail groundwork a SOC 2
  program needs, not the program.
- Multi-tenant _compute_ isolation (separate containers/VPCs per tenant) — this is data-layer
  isolation within one hosted deployment.
- Building the production-traffic recorder itself (§2.5) — only its stated prerequisite.

## Architecture

One new package, `@warden/enterprise`, plus small additive extensions to `@warden/core`,
`@warden/dashboard-api`, and `@warden/github-app`. No changes to `@warden/cli`,
`warden-action`, `@warden/orchestrator`, `@warden/runner`, or `@warden/test-management`.

### Additive types in `@warden/core`

New module `packages/core/src/auth.ts`, exported from `index.ts` alongside the existing
`coverage-sync.ts` / `v2.ts` additive contracts:

```ts
export type Role = 'viewer' | 'maintainer' | 'admin';

export interface TenantRef {
  id: string; // stable tenant id — derived from a GitHub installation id or SSO org domain
  name: string;
}

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

/** True if any of `principal.roles` is at or above `required` in viewer < maintainer < admin. */
export function hasRole(principal: Principal, required: Role): boolean;
```

`GateDecision` (`packages/core/src/change-surface.ts`) gains three **optional** fields — a
backward-compatible, additive change; every existing reader that ignores unknown fields keeps
working unmodified:

```ts
export interface GateDecision {
  decision: 'PASS' | 'WARN' | 'BLOCK';
  reason: string;
  overridden?: boolean;
  overriddenBy?: string; // Principal.subject
  overrideReason?: string;
}
```

### `@warden/enterprise` (new package)

Hosted-only. Depends on `@warden/core`, `@warden/dashboard-api`, `@warden/test-management`
(for the per-tenant `SqliteStore`), and `@warden/coverage-sync`'s `GitHubAccess`/`PrRef`
types. Nothing in `@warden/cli` or `warden-action` imports it.

```ts
// oidc-auth-provider.ts
export interface JwksFetcher {
  /** Injected so tests never hit a network JWKS endpoint. */
  getKey(kid: string): Promise<CryptoKey | Uint8Array>;
}

export interface RoleMapping {
  /** IdP group/claim value -> Warden role, per tenant. */
  groupToRole: Record<string, Role>;
  defaultRole: Role; // role granted to any authenticated user with no matching group
}

export function createOidcAuthProvider(opts: {
  issuer: string;
  audience: string;
  jwks: JwksFetcher;
  resolveTenant: (claims: Record<string, unknown>) => TenantRef;
  roleMapping: (tenant: TenantRef) => RoleMapping;
  clockSkewToleranceSeconds?: number; // default 60
}): AuthProvider;

// rbac-guard.ts
export class AuthzError extends WardenError {
  constructor(required: Role, actual: Role[]);
}
export function requireRole(principal: Principal, required: Role): void; // throws AuthzError

// sqlite-audit-sink.ts
export function createSqliteAuditSink(dbPath: string /* or ':memory:' */): AuditSink;

// tenant-store-registry.ts
/** Lazily opens and caches one `SqliteStore` per tenant id; never shares a handle across tenants. */
export interface TenantStoreRegistry {
  storeFor(tenant: TenantRef): SqliteStore;
}
export function createTenantStoreRegistry(opts: {
  dbPathFor: (tenant: TenantRef) => string;
}): TenantStoreRegistry;

// with-tenant-scope.ts
/** Wraps a DashboardDataApi bound to one tenant's store; throws (never silently filters) on cross-tenant access. */
export function withTenantScope(api: DashboardDataApi, tenant: TenantRef): DashboardDataApi;

// gate-override-handler.ts
export interface GateOverrideHandler {
  override(input: {
    principal: Principal;
    pr: PrRef;
    decision: GateDecision;
    reason: string;
  }): Promise<GateDecision>; // amended decision, audited, check-run flipped
}
export function createGateOverrideHandler(deps: {
  requiredRole: Role;
  auditSink: AuditSink;
  gh: GitHubAccess; // reused from @warden/core coverage-sync contract
}): GateOverrideHandler;

// suggestion-merge-auditor.ts
export interface SuggestionMergeAuditor {
  /** No-op unless the merged branch matches the coverage-sync prefix (`warden/sync-*`). */
  onPullRequestClosed(
    tenant: TenantRef,
    pr: PrRef & { merged: boolean; branch: string; mergedBy: { login: string; email?: string } },
  ): Promise<void>;
}
export function createSuggestionMergeAuditor(auditSink: AuditSink): SuggestionMergeAuditor;

// noop.ts — defaults used whenever `enterprise.auth.mode === 'none'`
export const noopAuditSink: AuditSink;
export const openAuthProvider: AuthProvider; // resolves every token to a single implicit admin Principal
```

`noopAuditSink` / `openAuthProvider` mirror the existing `NoopMetricsEmitter` pattern in
`@warden/observability` — the "off" state is a real, fully-typed implementation, not a branch
scattered through calling code.

### Extended (additive, no breaking changes)

- **`@warden/dashboard-api`** — no change to `SqliteDashboardApi`. `@warden/enterprise`'s
  `withTenantScope` wraps it; a hosted deployment composes
  `withTenantScope(new SqliteDashboardApi(store), principal.tenant)`, a self-hosted one uses
  `SqliteDashboardApi` directly, unwrapped, as today.
- **`@warden/github-app`** — two additive webhook handlers alongside the existing
  `pull_request` → `run()` (coverage-sync) handler:
  - `issue_comment` on a PR, matching `/warden override <reason>` → resolves the commenter to
    a `Principal` (see Safety) → `GateOverrideHandler.override(...)`.
  - `pull_request` (`closed`, `merged: true`) on a `warden/sync-*` branch →
    `SuggestionMergeAuditor.onPullRequestClosed(...)`.
    Both are no-ops when `enterprise.auth.mode === 'none'` (the defaults above make them no-ops
    automatically — `openAuthProvider` still resolves a Principal, but `requiredRole: 'viewer'`
    paired with `noopAuditSink` means the override still works, just isn't gated or audited,
    which is the correct self-hosted default).

## Configuration

Additive `enterprise` block on `WardenConfigSchema`. Everything defaults to today's behavior —
no login, no RBAC enforcement, no audit records kept.

```ts
export default defineConfig({
  enterprise: {
    auth: {
      mode: 'none', // 'none' | 'oidc' — default 'none' (self-hosted OSS default)
      requiredRoleForGateOverride: 'maintainer',
      requiredRoleForSuggestionMerge: 'maintainer',
      requiredRoleForRoleChange: 'admin',
    },
    audit: {
      enabled: false, // auto-true when auth.mode !== 'none'; can be forced on independently
      retentionDays: 400,
    },
    dataHandling: {
      // Documents the posture this config enforces; read by the retention job (see Rollout).
      piiScrubbing: true,
      executionHistoryRetentionDays: 400,
    },
  },
});
```

OIDC issuer/client secrets (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
`OIDC_AUDIENCE`) are **deployment** configuration, not per-repo `warden.config.ts` — they live
in `deploy/.env` alongside the App's existing `appId`/`privateKey`/`webhookSecret`, since they
describe the hosted operator's IdP, not any one repository. `@warden/enterprise` refuses to
start (throws `ConfigError`) if `enterprise.auth.mode: 'oidc'` is set but the deployment
secrets are missing — it never silently falls back to the open default.

## Data flow

1. A hosted deployment sets `enterprise.auth.mode: 'oidc'` and the deployment-level OIDC
   secrets. A user opens the dashboard and is redirected to the org's IdP; the callback route
   (in `apps/dashboard`, outside this package's scope) exchanges the code for an ID token.
2. `createOidcAuthProvider(...).verify(idToken)` validates the token against the injected
   `JwksFetcher`, maps IdP groups/claims to a Warden role via `RoleMapping`, and returns a
   `Principal { subject, email, tenant, roles }`. A `login` `AuditEvent` is recorded.
3. `TenantStoreRegistry.storeFor(principal.tenant)` resolves the correct per-tenant
   `SqliteStore`; `withTenantScope(dashboardApi, principal.tenant)` wraps
   `SqliteDashboardApi` so every subsequent read is bound to that tenant's store — a request
   for another tenant's data cannot resolve to a different store instance.
4. `viewer` sees the coverage matrix, trends, and flake board (unchanged
   `SqliteDashboardApi` methods) read-only. `maintainer`/`admin` additionally see an
   "Override" action on any `BLOCK` gate decision and "Merge" / "Dismiss" actions on
   coverage-sync draft-PR suggestions (from `2026-07-08-cross-repo-coverage-sync.md`).
5. A PR's merge gate returns `BLOCK` (existing `@warden/orchestrator` `evaluate-exit-criteria`
   → `GateDecision`). A maintainer clicks **Override** in the dashboard (or comments
   `/warden override: flaky infra, verified manually` on the PR — see Safety for how the
   comment author is bound to a `Principal`).
6. `GateOverrideHandler.override({ principal, pr, decision, reason })`: `requireRole(principal,
cfg.enterprise.auth.requiredRoleForGateOverride)` — throws `AuthzError` (surfaced as a 403 /
   a rejected comment) for `viewer`. On success it amends the decision
   (`overridden: true, overriddenBy, overrideReason`), calls the injected `GitHubAccess`'s
   `postCheckRun(pr, 'success', ...)` to flip the check-run, and calls `auditSink.record({
action: 'gate.override', ... })`.
7. The amended `GateDecision` flows through the existing `QAPlatformPlugin.onGateDecision`
   hook unchanged, so any plugin (Slack alert, issue-tracker sync) observes the override the
   same way it observes any other gate decision.
8. Separately, when a coverage-sync draft PR (`warden/sync-<repo>-pr-<n>`, opened by the
   existing `@warden/github-app` `run()` handler) is merged, the App's `pull_request` (closed,
   `merged: true`) handler calls `SuggestionMergeAuditor.onPullRequestClosed(...)`, which
   records a `suggestion.merged` `AuditEvent` if the branch matches the coverage-sync prefix
   and no-ops otherwise.
9. An `admin` opens the dashboard's Audit Log view, backed by `AuditSink.query({ tenant,
from, to, action })` — every override, every merged suggestion, every login and role
   change, scoped to their tenant only.
10. A retention job (documented, scheduled by the operator — see Rollout) purges `AuditEvent`
    rows and execution-history rows past `enterprise.audit.retentionDays` /
    `enterprise.dataHandling.executionHistoryRetentionDays`, using the pure
    `purgeableAuditEvents(events, retentionDays, now)` helper so the cutoff logic itself is
    deterministically testable without a real clock or a real database.

## Units & files

| File                                                  | Responsibility                                                                                                                       | Deps                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `packages/core/src/auth.ts`                           | `Role`, `TenantRef`, `Principal`, `AuthProvider`, `AuditAction`, `AuditEvent`, `AuditSink`, `hasRole`. Additive core contracts only. | none                                   |
| `packages/enterprise/src/oidc-auth-provider.ts`       | `createOidcAuthProvider` — token verification + claims→role mapping, over an injected `JwksFetcher`.                                 | core, `jose`                           |
| `packages/enterprise/src/role-mapper.ts`              | Pure `mapClaimsToRoles(claims, mapping) -> Role[]`.                                                                                  | core                                   |
| `packages/enterprise/src/rbac-guard.ts`               | `requireRole`, `AuthzError`.                                                                                                         | core                                   |
| `packages/enterprise/src/sqlite-audit-sink.ts`        | `createSqliteAuditSink` — append-only table, `record`/`query`, ids via `contentId`.                                                  | core, `better-sqlite3`                 |
| `packages/enterprise/src/tenant-store-registry.ts`    | `createTenantStoreRegistry` — lazy, cached, one `SqliteStore` per tenant id.                                                         | test-management                        |
| `packages/enterprise/src/with-tenant-scope.ts`        | Wraps a `DashboardDataApi`, fails closed on any cross-tenant access.                                                                 | core, dashboard-api types              |
| `packages/enterprise/src/gate-override-handler.ts`    | `createGateOverrideHandler` — RBAC check, decision amendment, check-run flip, audit record.                                          | core, coverage-sync `GitHubAccess`     |
| `packages/enterprise/src/suggestion-merge-auditor.ts` | `createSuggestionMergeAuditor` — branch-prefix match, audit record.                                                                  | core                                   |
| `packages/enterprise/src/retention.ts`                | Pure `purgeableAuditEvents(events, retentionDays, now)`.                                                                             | core                                   |
| `packages/enterprise/src/noop.ts`                     | `noopAuditSink`, `openAuthProvider` — the `mode: 'none'` defaults.                                                                   | core                                   |
| `packages/enterprise/src/index.ts`                    | Public exports.                                                                                                                      | —                                      |
| `packages/github-app/src/comment-webhook.ts` (new)    | `issue_comment` handler parsing `/warden override <reason>`, binding the commenter, calling `GateOverrideHandler`.                   | enterprise, existing `app.ts` patterns |
| `packages/github-app/src/merge-webhook.ts` (new)      | `pull_request` (closed) handler calling `SuggestionMergeAuditor`.                                                                    | enterprise                             |

## Safety & error handling

- **Fail closed, always.** `openAuthProvider` (the `mode: 'none'` default) is an explicit,
  fully-typed no-auth implementation — never a fallback path reached by catching an error.
  Any unexpected verification failure in `createOidcAuthProvider` rejects the request (401);
  it never falls back to `openAuthProvider`.
- **`AuthzError`** (`WardenError`, code `E_AUTHZ`) is thrown by `requireRole` and mapped to a
  403 at the HTTP layer / a rejected PR comment reply ("you need maintainer access to
  override this gate") at the GitHub App layer. No partial side effects happen before the
  role check — `requireRole` runs first in every handler.
- **Tenant isolation is fail-closed, not filter-based.** `withTenantScope` and
  `TenantStoreRegistry` never return another tenant's rows filtered down to zero; a request
  for a resource outside `principal.tenant` throws, so a bug in a filter clause can't silently
  degrade into a leak.
- **Audit log is append-only by contract** — `AuditSink` exposes no update/delete method.
  Event ids are content-derived (`contentId`, from `@warden/core/ids.ts`) so re-processing the
  same webhook delivery (GitHub's at-least-once delivery) is idempotent rather than
  double-logged.
- **Comment-triggered overrides require a bound identity.** A GitHub comment author is _not_
  automatically a `Principal` — `/warden override` only resolves if that GitHub login was
  previously bound to an OIDC identity via a first dashboard login (`Principal.subject`
  stored against the GitHub login at that time). An unbound commenter gets a clear reply
  directing them to the dashboard; this prevents a compromised or spoofed comment from
  self-service overriding a gate.
- **JWKS resilience.** Cached keys are reused within a TTL window on fetch failure; total
  failure rejects the token (401) rather than accepting an unverifiable one. Clock-skew
  tolerance is a small, explicit window (default 60s) — not a disabled `exp` check.
- **Least privilege unchanged.** The override/merge-audit handlers reuse the coverage-sync
  App's existing `checks: write` / `pull_requests: write` scopes; no new GitHub permissions
  are requested.
- **Self-hosted path is untouched.** `@warden/cli` and `warden-action` never import
  `@warden/enterprise`; a self-hosted dashboard instantiates `SqliteDashboardApi` directly, so
  there is no new dependency, config requirement, or runtime behavior change for the default
  OSS path.

## Testing

Fully hermetic — no live IdP, no live GitHub, no live database beyond `better-sqlite3`'s
`:memory:` mode:

- `oidc-auth-provider`: a fake `JwksFetcher` (fixed key) drives token fixtures — valid token →
  expected `Principal`; expired `exp` → rejected; wrong `iss`/`aud` → rejected; a claims fixture
  with no matching group → falls back to `RoleMapping.defaultRole`.
- `role-mapper`: table-driven claims/group fixtures → expected `Role[]`.
- `rbac-guard`: a `viewer` principal calling `requireRole(..., 'maintainer')` throws
  `AuthzError`; `admin` succeeds for any required role (role hierarchy is transitively
  covered by `hasRole`'s own unit tests).
- `sqlite-audit-sink`: `:memory:` db — `record` then `query` round-trips one event; two
  tenants' events never appear in each other's `query` results; no delete/update method is
  exposed (a type-level assertion, not a runtime one).
- `tenant-store-registry` / `with-tenant-scope`: two fake tenants, two fake stores — a
  `withTenantScope`-wrapped API call for tenant B's resource while authenticated as tenant A
  throws rather than returning an empty/filtered result.
- `gate-override-handler`: a fake `GitHubAccess` and `AuditSink` —
  - `viewer` principal + `BLOCK` decision → `AuthzError`, zero calls to `postCheckRun` or
    `auditSink.record`.
  - `maintainer` principal + `BLOCK` decision → exactly one `postCheckRun('success', ...)`
    call, exactly one `auditSink.record({ action: 'gate.override', ... })` call with the
    correct `actor`/`resource`, and the returned `GateDecision` has `overridden: true`.
- `suggestion-merge-auditor`: a merged `pull_request.closed` event on
  `warden/sync-service-checkout-pr-42` → one `suggestion.merged` audit record; the same event
  with `merged: false` → no-op; a merge on an unrelated branch → no-op.
- `retention`: `purgeableAuditEvents(events, retentionDays, now)` — pure function, fixed `now`,
  fixture events straddling the cutoff → exact expected id set, no reliance on `Date.now()`.
- `noop`: with `enterprise.auth.mode: 'none'`, asserts the composed dashboard/App handlers
  call the plain `SqliteDashboardApi` / unrestricted `GateOverrideHandler` paths directly —
  i.e. the "off" state is exercised as its own first-class test, not just an absence of
  `enterprise` tests.

## Rollout

1. Land the additive `@warden/core` types (`auth.ts`, the three optional `GateDecision`
   fields) and the `enterprise` config block with `mode: 'none'` defaults — zero behavior
   change to any existing package or test.
2. Build `@warden/enterprise` (OIDC provider, RBAC guard, SQLite audit sink, tenant store
   registry, gate-override handler, suggestion-merge auditor) — fully hermetic, no App or
   dashboard wiring required yet.
3. Wire `apps/dashboard` + `@warden/dashboard-api` (login route, tenant-scoped API
   composition, Audit Log view) and `@warden/github-app` (comment + merge-close webhook
   handlers) behind `enterprise.auth.mode`.
4. Document the data-handling/retention posture in `docs/` (what's stored, for how long, PII
   scrubbing posture) — the explicit prerequisite the gap analysis calls out for §2.5 — and
   stand up the retention purge job in `deploy/` (a scheduled job invoking
   `purgeableAuditEvents` against the live stores).
5. Dogfood SSO end-to-end against a real OIDC IdP in a hosted deployment; only then enable
   `mode: 'oidc'` by default in the hosted offering (self-hosted stays `mode: 'none'` by
   default indefinitely).

## Risks & open items

- **SCIM provisioning** is out of scope for v1 — roles are mapped from IdP claims at login
  time, not synced/de-provisioned automatically. An offboarded IdP user simply can no longer
  obtain a new session; revoking an already-issued session early would need a token-revocation
  list, not designed here.
- **Store-per-tenant SQLite** matches Warden's existing SQLite-first design and is simple to
  reason about for isolation, but a hosted deployment with a very large number of tenants may
  eventually need a shared, tenant-columned store (e.g. Postgres) instead of one file per
  tenant — flagged, not blocking this version.
- **Comment-triggered overrides depend on identity binding** (GitHub login ↔ OIDC subject) set
  up at a prior dashboard login; a maintainer who has never logged into the dashboard cannot
  use `/warden override` until they do, which is a deliberate but occasionally surprising
  restriction.
- **Compliance evidence packaging** (SOC 2-ready exports of the audit log, access reviews,
  pen-testing) is explicitly not designed here — this proposal is the access-control and
  audit-trail primitive that program would consume.
- **Retention job scheduling mechanism** (cron inside `deploy/docker-compose.yml` vs. an
  external scheduler) is left to the hosting operator; only the pure cutoff logic is specified
  and tested here.
