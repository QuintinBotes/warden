import { describe, it, expect } from 'vitest';
import { hasRole, type Principal, type Role } from './auth';

function principal(roles: Role[]): Principal {
  return {
    subject: 'sub-1',
    email: 'user@example.com',
    tenant: { id: 't1', name: 'Tenant One' },
    roles,
  };
}

describe('hasRole', () => {
  const cases: Array<{ roles: Role[]; required: Role; expected: boolean }> = [
    { roles: ['viewer'], required: 'viewer', expected: true },
    { roles: ['viewer'], required: 'maintainer', expected: false },
    { roles: ['viewer'], required: 'admin', expected: false },
    { roles: ['maintainer'], required: 'viewer', expected: true },
    { roles: ['maintainer'], required: 'maintainer', expected: true },
    { roles: ['maintainer'], required: 'admin', expected: false },
    { roles: ['admin'], required: 'viewer', expected: true },
    { roles: ['admin'], required: 'maintainer', expected: true },
    { roles: ['admin'], required: 'admin', expected: true },
    { roles: ['viewer', 'admin'], required: 'maintainer', expected: true },
    { roles: [], required: 'viewer', expected: false },
  ];

  for (const { roles, required, expected } of cases) {
    it(`[${roles.join(', ') || 'none'}] vs required ${required} -> ${expected}`, () => {
      expect(hasRole(principal(roles), required)).toBe(expected);
    });
  }
});
