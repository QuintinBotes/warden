/**
 * Tiny className combiner. Filters out falsy values and joins with a space.
 * Internal helper — not part of the public API.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
