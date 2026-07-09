import { describe, it, expect } from 'vitest';
import type { Role } from '@warden/core';
import { mapClaimsToRoles, type RoleMapping } from './role-mapper.js';

const mapping: RoleMapping = {
  groupToRole: {
    'warden-admins': 'admin',
    'warden-maintainers': 'maintainer',
    'warden-viewers': 'viewer',
  },
  defaultRole: 'viewer',
};

describe('mapClaimsToRoles', () => {
  const cases: Array<{ name: string; claims: Record<string, unknown>; expected: Role[] }> = [
    { name: 'single matching group', claims: { groups: ['warden-admins'] }, expected: ['admin'] },
    {
      name: 'multiple matching groups (deduped, order preserved)',
      claims: { groups: ['warden-maintainers', 'warden-admins', 'warden-maintainers'] },
      expected: ['maintainer', 'admin'],
    },
    {
      name: 'reads the `roles` claim too',
      claims: { roles: ['warden-viewers'] },
      expected: ['viewer'],
    },
    {
      name: 'single string group (not an array)',
      claims: { groups: 'warden-admins' },
      expected: ['admin'],
    },
    {
      name: 'no matching group falls back to defaultRole',
      claims: { groups: ['some-other-team'] },
      expected: ['viewer'],
    },
    { name: 'no groups claim at all falls back to defaultRole', claims: {}, expected: ['viewer'] },
  ];

  for (const { name, claims, expected } of cases) {
    it(name, () => {
      expect(mapClaimsToRoles(claims, mapping)).toEqual(expected);
    });
  }
});
