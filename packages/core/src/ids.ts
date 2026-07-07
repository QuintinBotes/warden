/**
 * Deterministic id helpers. These are intentionally pure — no `Date.now()` and no
 * randomness — so ids are stable across runs and reproducible in tests and in the
 * swarm build (where non-determinism would break resume/caching).
 */

/** `sequentialId('TC', 42) === 'TC-042'` — zero-padded to at least three digits. */
export function sequentialId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/**
 * `contentId('exec', 'PR-89:checkout')` — a stable id derived from content via a
 * 32-bit FNV-1a hash. Same content always yields the same id; different content
 * (almost always) yields a different one.
 */
export function contentId(prefix: string, content: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `${prefix}-${hex}`;
}
