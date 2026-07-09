import type { ShareTokenSigner } from '@warden/core';

/**
 * Mint a signed, opaque share token granting read-only access to one run. `nowMs` is the
 * injected clock reading; the token expires `ttlSec` seconds later.
 */
export function mintShareToken(
  executionId: string,
  signer: ShareTokenSigner,
  nowMs: number,
  ttlSec: number,
): string {
  return signer.sign({
    executionId,
    scope: 'run',
    issuedAt: nowMs,
    expiresAt: nowMs + ttlSec * 1000,
  });
}

/**
 * Resolve a share token to the execution id it grants access to, or `null` if the token is
 * tampered, malformed, or expired at `nowMs`.
 */
export function resolveShare(
  token: string,
  signer: ShareTokenSigner,
  nowMs: number,
): string | null {
  const payload = signer.verify(token, nowMs);
  return payload ? payload.executionId : null;
}
