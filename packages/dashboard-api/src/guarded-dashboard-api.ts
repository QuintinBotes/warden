import type {
  CoverageFilter,
  DashboardDataApi,
  DateRange,
  Principal,
  Role,
  TrendMetric,
} from '@warden/core';

/**
 * An injected RBAC check — the seam `@warden/enterprise`'s `requireRole` satisfies. Kept as an
 * interface (consumed via injection) so `@warden/dashboard-api` gains an optional auth layer
 * without depending on `@warden/enterprise`.
 */
export type RoleGuard = (principal: Principal, required: Role) => void;

export interface GuardedDashboardApiOptions {
  /** The authenticated principal reads are performed on behalf of. */
  principal: Principal;
  /** Minimum role required to read. Defaults to `'viewer'`. */
  requiredRole?: Role;
  /**
   * Injected RBAC check. When omitted (self-hosted / `enterprise.auth.mode: 'none'`) the guard
   * is a no-op, so behavior is identical to using the underlying api directly.
   */
  requireRole?: RoleGuard;
}

/**
 * Wraps a {@link DashboardDataApi} so every read first passes an injected RBAC check. This is the
 * additive hosted-surface guard: composed as
 * `createGuardedDashboardApi(new SqliteDashboardApi(store), { principal, requireRole })` in a
 * hosted deployment, and simply not used (the api is consumed directly) when self-hosted.
 */
export function createGuardedDashboardApi(
  api: DashboardDataApi,
  opts: GuardedDashboardApiOptions,
): DashboardDataApi {
  const requiredRole: Role = opts.requiredRole ?? 'viewer';
  const check = (): void => {
    if (opts.requireRole) opts.requireRole(opts.principal, requiredRole);
  };
  return {
    async listRequirements(filter?: CoverageFilter) {
      check();
      return api.listRequirements(filter);
    },
    async coverageMatrix() {
      check();
      return api.coverageMatrix();
    },
    async executions(range: DateRange) {
      check();
      return api.executions(range);
    },
    async flakeBoard() {
      check();
      return api.flakeBoard();
    },
    async trends(metric: TrendMetric, range: DateRange) {
      check();
      return api.trends(metric, range);
    },
  };
}
