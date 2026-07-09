import { describe, it, expect } from 'vitest';
import type { CoverageCell, DashboardDataApi, TenantRef } from '@warden/core';
import { TenantScopeError, withTenantScope } from './with-tenant-scope.js';

const tenantA: TenantRef = { id: 'acme', name: 'Acme' };
const tenantB: TenantRef = { id: 'globex', name: 'Globex' };

/** A fake DashboardDataApi that tags its coverage rows with the tenant that owns its store. */
function fakeApiFor(tenant: TenantRef): DashboardDataApi {
  return {
    async listRequirements() {
      return [];
    },
    async coverageMatrix(): Promise<CoverageCell[]> {
      return [{ requirementId: `REQ-${tenant.id}`, testCaseId: 'TC-1', lastResult: 'PASS' }];
    },
    async executions() {
      return [];
    },
    async flakeBoard() {
      return [];
    },
    async trends() {
      return [];
    },
  };
}

describe('withTenantScope', () => {
  it("binds reads to the wrapped tenant's api", async () => {
    const scoped = withTenantScope(fakeApiFor(tenantA), tenantA);
    expect(scoped.tenant).toEqual(tenantA);
    const cells = await scoped.coverageMatrix();
    expect(cells[0]?.requirementId).toBe('REQ-acme'); // served from tenant A's store
  });

  it('fails closed (throws) on a cross-tenant request rather than filtering to empty', () => {
    const scoped = withTenantScope(fakeApiFor(tenantA), tenantA);
    expect(() => scoped.assertTenant(tenantA)).not.toThrow();
    expect(() => scoped.assertTenant(tenantB)).toThrow(TenantScopeError);
  });

  it('carries the expected/requested tenants on the scope error', () => {
    const scoped = withTenantScope(fakeApiFor(tenantA), tenantA);
    try {
      scoped.assertTenant(tenantB);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TenantScopeError);
      const scopeErr = err as TenantScopeError;
      expect(scopeErr.code).toBe('E_TENANT_SCOPE');
      expect(scopeErr.expected.id).toBe('acme');
      expect(scopeErr.requested.id).toBe('globex');
    }
  });
});
