import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ShareTokenPayload, ShareTokenSigner } from '@warden/core';

/**
 * An HMAC-SHA256 {@link ShareTokenSigner}. A token is `${payloadB64}.${sigB64}` where
 * `payloadB64` is base64url(JSON(payload)) and `sigB64` is base64url(HMAC-SHA256(secret,
 * payloadB64)). `verify` recomputes the signature and compares it in constant time, then
 * rejects anything whose `expiresAt` is at or before `nowMs`.
 *
 * The secret is injected (never read from config): the operator passes it from the
 * environment. Pure crypto — no I/O — so it is fully hermetic to unit-test.
 */
export function createHmacSigner(secret: string): ShareTokenSigner {
  const computeSig = (payloadB64: string): string =>
    createHmac('sha256', secret).update(payloadB64).digest('base64url');

  return {
    sign(payload: ShareTokenPayload): string {
      const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      return `${payloadB64}.${computeSig(payloadB64)}`;
    },

    verify(token: string, nowMs: number): ShareTokenPayload | null {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const payloadB64 = parts[0];
      const sigB64 = parts[1];
      if (!payloadB64 || !sigB64) return null;

      const expected = computeSig(payloadB64);
      const provided = Buffer.from(sigB64);
      const expectedBuf = Buffer.from(expected);
      // Constant-time compare; a length mismatch alone is already a rejection.
      if (provided.length !== expectedBuf.length) return null;
      if (!timingSafeEqual(provided, expectedBuf)) return null;

      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (!isShareTokenPayload(payload)) return null;
      if (payload.expiresAt <= nowMs) return null;
      return payload;
    },
  };
}

function isShareTokenPayload(value: unknown): value is ShareTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.executionId === 'string' &&
    p.scope === 'run' &&
    typeof p.issuedAt === 'number' &&
    typeof p.expiresAt === 'number'
  );
}
