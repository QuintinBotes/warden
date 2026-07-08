import type { LocatorRef } from '@warden/core';

/** True when `text` looks like a real unified diff (has both `---`/`+++` file headers). */
export function isUnifiedDiff(text: string): boolean {
  return /^--- /m.test(text) && /^\+\+\+ /m.test(text);
}

/** Reconstruct the source form of a locator call, for the "before"/"after" diff lines. */
export function renderLocatorCall(kind: LocatorRef['kind'], role: string, name: string): string {
  if (kind === 'fill') return `getByLabel('${name}')`;
  return `getByRole('${role}', { name: '${name}' })`;
}

/**
 * A minimal, reviewer-friendly unified-diff patch that rewrites a single locator's name at its
 * source line. Deterministic in its inputs (no timestamps), so re-running on the same locator
 * produces byte-identical output — which keeps the draft PR idempotent.
 */
export function buildLocatorPatch(locator: LocatorRef, suggestedName: string): string {
  const before = renderLocatorCall(locator.kind, locator.role, locator.name);
  const after = renderLocatorCall(locator.kind, locator.role, suggestedName);
  const line = locator.line;
  return [
    `--- a/${locator.filePath}`,
    `+++ b/${locator.filePath}`,
    `@@ -${line},1 +${line},1 @@`,
    `-  ${before}`,
    `+  ${after}`,
    '',
  ].join('\n');
}
