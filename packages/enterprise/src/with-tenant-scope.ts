import { WardenError, type DashboardDataApi, type TenantRef } from '@warden/core';

/** Thrown (code `E_TENANT_SCOPE`) when a request targets a tenant other than the bound scope. */
export class TenantScopeError extends WardenError {
  readonly expected: TenantRef;
  readonly requested: TenantRef;

  constructor(expected: TenantRef, requested: TenantRef) {
    super(
      `cross-tenant access denied: scope is "${expected.id}" but "${requested.id}" was requested`,
      'E_TENANT_SCOPE',
    );
    this.name = 'TenantScopeError';
    this.expected = expected;
    this.requested = requested;
  }
}

/** A {@link DashboardDataApi} bound to exactly one tenant, with a fail-closed cross-tenant check. */
export interface TenantScopedDashboardApi extends DashboardDataApi {
  readonly tenant: TenantRef;
  /** Fail-closed: throws {@link TenantScopeError} if `requested` is not this scope's tenant. */
  assertTenant(requested: TenantRef): void;
}

/**
 * Wraps a {@link DashboardDataApi} bound to one tenant's store. The wrapper closes over a single
 * underlying api, so there is no path to another tenant's store; `assertTenant` is the explicit
 * fail-closed guard used at the request boundary, which throws (never silently filters) when a
 * request names a different tenant than the session's principal.
 */
export function withTenantScope(
  api: DashboardDataApi,
  tenant: TenantRef,
): TenantScopedDashboardApi {
  const assertTenant = (requested: TenantRef): void => {
    if (requested.id !== tenant.id) throw new TenantScopeError(tenant, requested);
  };
  return {
    tenant,
    assertTenant,
    listRequirements: (filter) => api.listRequirements(filter),
    coverageMatrix: () => api.coverageMatrix(),
    executions: (range) => api.executions(range),
    flakeBoard: () => api.flakeBoard(),
    trends: (metric, range) => api.trends(metric, range),
  };
}
