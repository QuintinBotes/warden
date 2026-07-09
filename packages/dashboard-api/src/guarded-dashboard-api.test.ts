import { describe, it, expect } from 'vitest';
import { hasRole, type DashboardDataApi, type Principal, type Role } from '@warden/core';
import { createGuardedDashboardApi } from './guarded-dashboard-api.js';

/** A minimal throwing RBAC check, standing in for `@warden/enterprise`'s injected `requireRole`. */
function requireRole(principal: Principal, required: Role): void {
  if (!hasRole(principal, required)) {
    throw new Error(`E_AUTHZ: requires ${required}`);
  }
}

function principal(roles: Role[]): Principal {
  return { subject: 's', email: 'e@x.com', tenant: { id: 't', name: 'T' }, roles };
}

/** A fake DashboardDataApi that records whether each read was actually delegated to. */
function trackingApi() {
  const calls: string[] = [];
  const api: DashboardDataApi = {
    async listRequirements() {
      calls.push('listRequirements');
      return [];
    },
    async coverageMatrix() {
      calls.push('coverageMatrix');
      return [];
    },
    async executions() {
      calls.push('executions');
      return [];
    },
    async flakeBoard() {
      calls.push('flakeBoard');
      return [];
    },
    async trends() {
      calls.push('trends');
      return [];
    },
  };
  return { api, calls };
}

describe('createGuardedDashboardApi', () => {
  it('delegates reads when the injected guard passes', async () => {
    const { api, calls } = trackingApi();
    const guarded = createGuardedDashboardApi(api, {
      principal: principal(['viewer']),
      requiredRole: 'viewer',
      requireRole,
    });
    await guarded.coverageMatrix();
    await guarded.flakeBoard();
    expect(calls).toEqual(['coverageMatrix', 'flakeBoard']);
  });

  it('blocks the read (throws before delegating) when the injected guard rejects', async () => {
    const { api, calls } = trackingApi();
    const guarded = createGuardedDashboardApi(api, {
      principal: principal(['viewer']),
      requiredRole: 'maintainer',
      requireRole,
    });
    await expect(guarded.coverageMatrix()).rejects.toThrow(/E_AUTHZ/);
    expect(calls).toEqual([]); // never reached the underlying api
  });

  it('is a permissive pass-through when no guard is injected (self-hosted / auth.mode none)', async () => {
    const { api, calls } = trackingApi();
    const guarded = createGuardedDashboardApi(api, { principal: principal([]) });
    await guarded.coverageMatrix();
    expect(calls).toEqual(['coverageMatrix']); // no requireRole -> behaves exactly like the raw api
  });
});
