import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import type { TenantRef } from '@warden/core';
import {
  createOidcAuthProvider,
  OidcVerificationError,
  type JwksFetcher,
} from './oidc-auth-provider.js';
import type { RoleMapping } from './role-mapper.js';

const ISSUER = 'https://idp.example.com/';
const AUDIENCE = 'warden-hosted';
// HS256 requires a >= 256-bit key; 32 ASCII bytes satisfies jose.
const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef');
const KID = 'test-key-1';

// Absolute far-future / far-past timestamps keep the fixtures deterministic (no wall-clock reliance).
const YEAR_2100 = 4102444800; // seconds
const YEAR_1970_ISH = 1000; // seconds

/** Fake JWKS: returns the fixed HMAC secret for any kid, never touching a network. */
const fakeJwks: JwksFetcher = {
  async getKey(): Promise<Uint8Array> {
    return SECRET;
  },
};

const roleMapping: RoleMapping = {
  groupToRole: { 'warden-admins': 'admin', 'warden-maintainers': 'maintainer' },
  defaultRole: 'viewer',
};

function tenant(): TenantRef {
  return { id: 'acme', name: 'Acme' };
}

function provider(overrides: Partial<Parameters<typeof createOidcAuthProvider>[0]> = {}) {
  return createOidcAuthProvider({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwks: fakeJwks,
    resolveTenant: () => tenant(),
    roleMapping: () => roleMapping,
    ...overrides,
  });
}

async function signToken(opts: {
  issuer?: string;
  audience?: string;
  exp?: number;
  claims?: Record<string, unknown>;
  sub?: string;
}): Promise<string> {
  return new SignJWT({ email: 'user@acme.com', ...opts.claims })
    .setProtectedHeader({ alg: 'HS256', kid: KID })
    .setIssuedAt(YEAR_1970_ISH)
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setSubject(opts.sub ?? 'user-123')
    .setExpirationTime(opts.exp ?? YEAR_2100)
    .sign(SECRET);
}

describe('createOidcAuthProvider', () => {
  it('resolves a valid token to the expected Principal', async () => {
    const token = await signToken({ claims: { groups: ['warden-admins'] } });
    const principal = await provider().verify(token);
    expect(principal).toEqual({
      subject: 'user-123',
      email: 'user@acme.com',
      tenant: { id: 'acme', name: 'Acme' },
      roles: ['admin'],
    });
  });

  it('falls back to RoleMapping.defaultRole when no group matches', async () => {
    const token = await signToken({ claims: { groups: ['unrelated-team'] } });
    const principal = await provider().verify(token);
    expect(principal.roles).toEqual(['viewer']);
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ exp: YEAR_1970_ISH + 100 }); // exp well in the past
    await expect(provider().verify(token)).rejects.toBeInstanceOf(OidcVerificationError);
  });

  it('rejects a wrong issuer', async () => {
    const token = await signToken({ issuer: 'https://evil.example.com/' });
    await expect(provider().verify(token)).rejects.toBeInstanceOf(OidcVerificationError);
  });

  it('rejects a wrong audience', async () => {
    const token = await signToken({ audience: 'someone-else' });
    await expect(provider().verify(token)).rejects.toBeInstanceOf(OidcVerificationError);
  });

  it('rejects a garbage token (never falls back to open auth)', async () => {
    await expect(provider().verify('not-a-jwt')).rejects.toBeInstanceOf(OidcVerificationError);
  });
});
