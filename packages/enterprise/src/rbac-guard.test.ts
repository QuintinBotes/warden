import { describe, it, expect } from 'vitest';
import type { Principal, Role } from '@warden/core';
import { AuthzError, requireRole } from './rbac-guard.js';

function principal(roles: Role[]): Principal {
  return { subject: 's', email: 'e@x.com', tenant: { id: 't', name: 'T' }, roles };
}

describe('requireRole', () => {
  it('throws AuthzError when a viewer is asked for maintainer', () => {
    expect(() => requireRole(principal(['viewer']), 'maintainer')).toThrow(AuthzError);
  });

  it('carries the required and actual roles on the error', () => {
    try {
      requireRole(principal(['viewer']), 'admin');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzError);
      const authz = err as AuthzError;
      expect(authz.code).toBe('E_AUTHZ');
      expect(authz.required).toBe('admin');
      expect(authz.actual).toEqual(['viewer']);
    }
  });

  it('admin satisfies any required role', () => {
    expect(() => requireRole(principal(['admin']), 'viewer')).not.toThrow();
    expect(() => requireRole(principal(['admin']), 'maintainer')).not.toThrow();
    expect(() => requireRole(principal(['admin']), 'admin')).not.toThrow();
  });

  it('maintainer satisfies viewer and maintainer but not admin', () => {
    expect(() => requireRole(principal(['maintainer']), 'viewer')).not.toThrow();
    expect(() => requireRole(principal(['maintainer']), 'maintainer')).not.toThrow();
    expect(() => requireRole(principal(['maintainer']), 'admin')).toThrow(AuthzError);
  });
});
