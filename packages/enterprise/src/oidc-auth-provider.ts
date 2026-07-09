import { jwtVerify, type JWTPayload } from 'jose';
import type { webcrypto } from 'node:crypto';
import { WardenError, type AuthProvider, type Principal, type TenantRef } from '@warden/core';
import { mapClaimsToRoles, type RoleMapping } from './role-mapper.js';

/** WebCrypto key type, sourced from Node's `crypto` module so no DOM lib is required. */
type CryptoKey = webcrypto.CryptoKey;

/**
 * Injected JWKS access so tests never hit a network JWKS endpoint. The default
 * implementation ({@link createRemoteJwksFetcher}) is a thin `jose` wrapper; unit tests inject
 * a fake returning a fixed key.
 */
export interface JwksFetcher {
  getKey(kid: string): Promise<CryptoKey | Uint8Array>;
}

export type { RoleMapping };

/** Raised (code `E_OIDC_VERIFY`) when a token cannot be verified. Never falls back to open auth. */
export class OidcVerificationError extends WardenError {
  constructor(message: string) {
    super(message, 'E_OIDC_VERIFY');
    this.name = 'OidcVerificationError';
  }
}

export interface OidcAuthProviderOptions {
  issuer: string;
  audience: string;
  jwks: JwksFetcher;
  resolveTenant: (claims: Record<string, unknown>) => TenantRef;
  roleMapping: (tenant: TenantRef) => RoleMapping;
  clockSkewToleranceSeconds?: number; // default 60
}

/**
 * An {@link AuthProvider} that verifies an OIDC id/bearer token against the injected
 * {@link JwksFetcher}, checks `iss`/`aud`/`exp` (with a small clock-skew tolerance), maps the
 * token's group claims to Warden roles, and resolves a {@link Principal}. Fails closed: any
 * verification failure rejects (throws {@link OidcVerificationError}); it never returns an
 * unauthenticated principal.
 */
export function createOidcAuthProvider(opts: OidcAuthProviderOptions): AuthProvider {
  const clockTolerance = opts.clockSkewToleranceSeconds ?? 60;
  return {
    async verify(token: string): Promise<Principal> {
      let payload: JWTPayload;
      try {
        const result = await jwtVerify(
          token,
          async (header) => {
            if (!header.kid) {
              throw new OidcVerificationError('token header is missing a `kid`');
            }
            return opts.jwks.getKey(header.kid);
          },
          { issuer: opts.issuer, audience: opts.audience, clockTolerance },
        );
        payload = result.payload;
      } catch (err) {
        if (err instanceof OidcVerificationError) throw err;
        const detail = err instanceof Error ? err.message : String(err);
        throw new OidcVerificationError(`OIDC token verification failed: ${detail}`);
      }

      const claims = payload as Record<string, unknown>;
      const subject = typeof payload.sub === 'string' ? payload.sub : '';
      if (!subject) {
        throw new OidcVerificationError('token is missing a subject (`sub`) claim');
      }
      const email = typeof claims.email === 'string' ? claims.email : '';
      const tenant = opts.resolveTenant(claims);
      const roles = mapClaimsToRoles(claims, opts.roleMapping(tenant));
      return { subject, email, tenant, roles };
    },
  };
}
