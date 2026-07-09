import type { Role } from '@warden/core';

/** IdP group/claim value -> Warden role, per tenant, with a fallback for the unmatched. */
export interface RoleMapping {
  /** IdP group/claim value -> Warden role. */
  groupToRole: Record<string, Role>;
  /** Role granted to any authenticated user with no matching group. */
  defaultRole: Role;
}

/** Claim keys inspected, in order, for the user's IdP group / role memberships. */
const GROUP_CLAIM_KEYS = ['groups', 'roles', 'wardenRoles'] as const;

/** Collect every string group value across the recognised claim keys (arrays or single strings). */
function extractGroups(claims: Record<string, unknown>): string[] {
  const groups: string[] = [];
  for (const key of GROUP_CLAIM_KEYS) {
    const value = claims[key];
    if (typeof value === 'string') {
      groups.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') groups.push(entry);
      }
    }
  }
  return groups;
}

/**
 * Pure mapping from a verified token's claims to Warden roles. Every group that matches an
 * entry in `mapping.groupToRole` contributes its role (deduped); when nothing matches, the
 * user gets exactly `mapping.defaultRole`.
 */
export function mapClaimsToRoles(claims: Record<string, unknown>, mapping: RoleMapping): Role[] {
  const roles = new Set<Role>();
  for (const group of extractGroups(claims)) {
    const role = mapping.groupToRole[group];
    if (role) roles.add(role);
  }
  if (roles.size === 0) return [mapping.defaultRole];
  return [...roles];
}
