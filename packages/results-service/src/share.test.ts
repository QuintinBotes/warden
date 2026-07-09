import { describe, expect, it } from 'vitest';
import { createHmacSigner } from './hmac-signer.js';
import { mintShareToken, resolveShare } from './share.js';

const NOW = 1_700_000_000_000;

describe('mintShareToken / resolveShare', () => {
  it('mints a token that resolves back to the execution id', () => {
    const signer = createHmacSigner('secret');
    const token = mintShareToken('EX-42', signer, NOW, 3_600);
    expect(resolveShare(token, signer, NOW + 1_000)).toBe('EX-42');
  });

  it('encodes expiry from nowMs + ttlSec', () => {
    const signer = createHmacSigner('secret');
    const token = mintShareToken('EX-42', signer, NOW, 60);
    // Still valid just before the ttl elapses...
    expect(resolveShare(token, signer, NOW + 59_000)).toBe('EX-42');
    // ...and null once the ttl has elapsed.
    expect(resolveShare(token, signer, NOW + 60_000)).toBeNull();
  });

  it('resolves to null for a token signed with another secret', () => {
    const token = mintShareToken('EX-42', createHmacSigner('a'), NOW, 3_600);
    expect(resolveShare(token, createHmacSigner('b'), NOW + 1_000)).toBeNull();
  });

  it('resolves to null for garbage', () => {
    const signer = createHmacSigner('secret');
    expect(resolveShare('garbage', signer, NOW)).toBeNull();
  });
});
