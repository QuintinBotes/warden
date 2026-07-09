import { WardenError, hasRole, type Principal, type Role } from '@warden/core';

/**
 * Thrown (code `E_AUTHZ`) when a principal lacks the required role. Mapped to a 403 at the HTTP
 * layer / a rejected PR-comment reply at the GitHub App layer.
 */
export class AuthzError extends WardenError {
  readonly required: Role;
  readonly actual: Role[];

  constructor(required: Role, actual: Role[]) {
    super(
      `requires "${required}" access; principal has [${actual.join(', ') || 'no roles'}]`,
      'E_AUTHZ',
    );
    this.name = 'AuthzError';
    this.required = required;
    this.actual = actual;
  }
}

/**
 * Fail-closed role check: throws {@link AuthzError} unless the principal holds `required` (or
 * higher). Runs before any side effect in every write handler.
 */
export function requireRole(principal: Principal, required: Role): void {
  if (!hasRole(principal, required)) {
    throw new AuthzError(required, principal.roles);
  }
}
