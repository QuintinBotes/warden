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

/** Escape a locator name so it can be matched literally inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite the accessible name in a real source line, returning `null` when the line does not
 * contain the locator call the ref describes.
 *
 * The four forms mirror `locator-extractor.ts` exactly — anything it can extract, this can
 * rewrite — and the quote character is preserved from the source, so the edit is the smallest
 * one that changes the name and nothing else.
 */
export function rewriteLocatorInLine(
  line: string,
  locator: LocatorRef,
  suggestedName: string,
): string | null {
  const name = escapeRegExp(locator.name);
  const role = escapeRegExp(locator.role);
  const patterns =
    locator.kind === 'click'
      ? [
          new RegExp(
            `(getByRole\\(\\s*(['"\`])${role}\\2\\s*,\\s*\\{[\\s\\S]*?\\bname\\s*:\\s*)(['"\`])${name}\\3`,
          ),
          new RegExp(`(\\bclick\\(\\s*(['"\`])${role}\\2\\s*,\\s*)(['"\`])${name}\\3`),
        ]
      : [
          new RegExp(`(getByLabel\\(\\s*)(['"\`])${name}\\2`),
          new RegExp(`(\\bfill\\(\\s*)(['"\`])${name}\\2`),
        ];

  for (const pattern of patterns) {
    if (!pattern.test(line)) continue;
    // A function replacer, so a `$` in the suggested name is never read as a group reference.
    // Every pattern above captures the prefix first and the name's own quote last, and the match
    // runs to the closing quote (a backreference), so the replacement re-emits both quotes.
    return line.replace(pattern, (...args) => {
      const groups = args.slice(1, -2) as string[];
      const prefix = groups[0] ?? '';
      const quote = groups[groups.length - 1] ?? "'";
      return `${prefix}${quote}${suggestedName}${quote}`;
    });
  }
  return null;
}

/**
 * A minimal, reviewer-friendly unified-diff patch that rewrites a single locator's name at its
 * source line. Deterministic in its inputs (no timestamps), so re-running on the same locator
 * produces byte-identical output — which keeps the draft PR idempotent.
 *
 * When the ref carries the `sourceLine` the extractor read (the normal case), the hunk is built
 * from that exact line, so the patch is one that actually APPLIES to the file. Without it the
 * hunk falls back to the reconstructed call form: still a readable proposal, but one the
 * publisher will refuse to apply rather than commit blind — see `publisher.ts`.
 */
export function buildLocatorPatch(locator: LocatorRef, suggestedName: string): string {
  const rewritten =
    locator.sourceLine === undefined
      ? null
      : rewriteLocatorInLine(locator.sourceLine, locator, suggestedName);

  const before =
    rewritten === null
      ? `  ${renderLocatorCall(locator.kind, locator.role, locator.name)}`
      : locator.sourceLine!;
  const after =
    rewritten === null
      ? `  ${renderLocatorCall(locator.kind, locator.role, suggestedName)}`
      : rewritten;

  const line = locator.line;
  return [
    `--- a/${locator.filePath}`,
    `+++ b/${locator.filePath}`,
    `@@ -${line},1 +${line},1 @@`,
    `-${before}`,
    `+${after}`,
    '',
  ].join('\n');
}
