import { describe, expect, it } from 'vitest';
import type { ShareTokenPayload } from '@warden/core';
import { createHmacSigner } from './hmac-signer.js';

const NOW = 1_000_000;

function payload(overrides: Partial<ShareTokenPayload> = {}): ShareTokenPayload {
  return {
    executionId: 'EX-1',
    scope: 'run',
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

describe('createHmacSigner', () => {
  it('produces a two-part `${payload}.${sig}` token', () => {
    const signer = createHmacSigner('super-secret');
    const token = signer.sign(payload());
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });

  it('signs deterministically for the same secret + payload', () => {
    const a = createHmacSigner('s').sign(payload());
    const b = createHmacSigner('s').sign(payload());
    expect(a).toBe(b);
  });

  it('round-trips: verify returns the original payload before expiry', () => {
    const signer = createHmacSigner('super-secret');
    const token = signer.sign(payload());
    const out = signer.verify(token, NOW + 1_000);
    expect(out).toEqual(payload());
  });

  it('returns null when the signature was produced with a different secret (tamper)', () => {
    const token = createHmacSigner('secret-a').sign(payload());
    const out = createHmacSigner('secret-b').verify(token, NOW + 1_000);
    expect(out).toBeNull();
  });

  it('returns null when the payload segment is tampered', () => {
    const signer = createHmacSigner('super-secret');
    const token = signer.sign(payload());
    const [, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify(payload({ executionId: 'EX-EVIL' })),
      'utf8',
    ).toString('base64url');
    expect(signer.verify(`${forged}.${sig}`, NOW + 1_000)).toBeNull();
  });

  it('returns null on a malformed (non two-part) token', () => {
    const signer = createHmacSigner('super-secret');
    expect(signer.verify('not-a-token', NOW)).toBeNull();
    expect(signer.verify('a.b.c', NOW)).toBeNull();
    expect(signer.verify('', NOW)).toBeNull();
  });

  it('returns null once expired (expiresAt <= nowMs)', () => {
    const signer = createHmacSigner('super-secret');
    const token = signer.sign(payload({ expiresAt: NOW + 10 }));
    expect(signer.verify(token, NOW + 9)).not.toBeNull();
    expect(signer.verify(token, NOW + 10)).toBeNull();
    expect(signer.verify(token, NOW + 11)).toBeNull();
  });

  it('does not throw on garbage that happens to have a dot', () => {
    const signer = createHmacSigner('super-secret');
    expect(signer.verify('###.$$$', NOW)).toBeNull();
  });
});
