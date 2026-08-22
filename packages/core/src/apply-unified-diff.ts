/**
 * A strict, dependency-free unified-diff applier.
 *
 * Warden's agents propose edits as unified diffs, but every publishing sink it has
 * (`GitHubAccess.openOrUpdateDraftPr`, the GitHub contents API underneath it, a
 * `VcsProvider.openDraftPr`) writes WHOLE FILES. Something has to turn one into the
 * other, and doing it by hand at each call site is how diff text ends up committed as
 * a file body. This is that one implementation.
 *
 * It refuses rather than guesses:
 *
 * - context must match byte-for-byte; there is no fuzz factor;
 * - a hunk that does not match at its stated line is retried ONLY as a whole-file
 *   search, and only a single match is accepted — two candidate sites is a refusal,
 *   because picking one would be a guess about which edit the agent meant;
 * - a patch carrying no hunks is a refusal, not a no-op success.
 *
 * A refusal carries a `reason` the caller is expected to surface, so an unapplied
 * suggestion is reported rather than silently dropped or silently written.
 */

export type ApplyPatchResult = { ok: true; content: string } | { ok: false; reason: string };

interface Hunk {
  /** 1-based first line of the pre-image this hunk replaces. */
  oldStart: number;
  /** The pre-image lines (context + removals), in order. */
  oldLines: string[];
  /** The post-image lines (context + additions), in order. */
  newLines: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse every hunk in `patch`, across any number of concatenated file diffs.
 *
 * Hunk bodies are consumed by the counts in the `@@` header rather than by "read until
 * something that does not look like a body line": a removal of a line that itself begins
 * with `---` is indistinguishable from the next file's header otherwise.
 */
export function parseUnifiedDiffHunks(patch: string): Hunk[] {
  const lines = patch.split('\n');
  const hunks: Hunk[] = [];

  for (let i = 0; i < lines.length; i++) {
    const header = HUNK_HEADER.exec(lines[i] ?? '');
    if (!header) continue;

    const oldStart = Number(header[1]);
    // A count omitted from `-a` / `+c` means exactly one line, per the unified-diff format.
    const oldCount = header[2] === undefined ? 1 : Number(header[2]);
    const newCount = header[4] === undefined ? 1 : Number(header[4]);

    const oldLines: string[] = [];
    const newLines: string[] = [];
    let j = i + 1;
    while (j < lines.length && (oldLines.length < oldCount || newLines.length < newCount)) {
      const line = lines[j] ?? '';
      // `\ No newline at end of file` is a note about the previous line, not a line.
      if (line.startsWith('\\')) {
        j++;
        continue;
      }
      const marker = line.slice(0, 1);
      const text = line.slice(1);
      if (marker === '-') {
        oldLines.push(text);
      } else if (marker === '+') {
        newLines.push(text);
      } else if (marker === ' ' || line === '') {
        // Many tools strip the trailing space from an empty context line.
        oldLines.push(marker === ' ' ? text : '');
        newLines.push(marker === ' ' ? text : '');
      } else {
        break; // Not a body line: the hunk ended early (truncated patch).
      }
      j++;
    }

    hunks.push({ oldStart, oldLines, newLines });
    i = j - 1;
  }

  return hunks;
}

/**
 * Apply `patch` to `original`, returning the resulting whole-file content.
 *
 * The result is what a caller may write to a file. When it is `{ ok: false }` the caller
 * must NOT write anything for that path — writing the patch text itself is the bug this
 * function exists to make impossible.
 */
export function applyUnifiedDiff(original: string, patch: string): ApplyPatchResult {
  const hunks = parseUnifiedDiffHunks(patch);
  if (hunks.length === 0) return { ok: false, reason: 'patch carries no unified-diff hunks' };

  const lines = original.split('\n');
  // Every applied hunk shifts the lines after it, so later hunks' stated positions move.
  let drift = 0;

  for (const hunk of hunks) {
    const stated = hunk.oldStart - 1 + drift;

    if (hunk.oldLines.length === 0) {
      // A pure insertion has no context to locate; its stated position is all there is.
      if (stated < 0 || stated > lines.length) {
        return { ok: false, reason: `insertion at line ${hunk.oldStart} is outside the file` };
      }
      lines.splice(stated, 0, ...hunk.newLines);
      drift += hunk.newLines.length;
      continue;
    }

    let at = matchesAt(lines, hunk.oldLines, stated) ? stated : -1;
    if (at < 0) {
      const found = findSoleMatch(lines, hunk.oldLines);
      if (found.count === 0) {
        return {
          ok: false,
          reason: `hunk at line ${hunk.oldStart} does not match the file (context differs)`,
        };
      }
      if (found.count > 1) {
        return {
          ok: false,
          reason: `hunk at line ${hunk.oldStart} matches ${found.count} places in the file; refusing to guess which`,
        };
      }
      at = found.index;
    }

    lines.splice(at, hunk.oldLines.length, ...hunk.newLines);
    drift += hunk.newLines.length - hunk.oldLines.length;
  }

  return { ok: true, content: lines.join('\n') };
}

function matchesAt(lines: string[], block: string[], at: number): boolean {
  if (at < 0 || at + block.length > lines.length) return false;
  for (let k = 0; k < block.length; k++) {
    if (lines[at + k] !== block[k]) return false;
  }
  return true;
}

/** How many places `block` occurs at, and the index of the first — used only when 1. */
function findSoleMatch(lines: string[], block: string[]): { count: number; index: number } {
  let count = 0;
  let index = -1;
  for (let at = 0; at + block.length <= lines.length; at++) {
    if (!matchesAt(lines, block, at)) continue;
    count++;
    if (count === 1) index = at;
    if (count > 1) break; // Two is already a refusal; counting further buys nothing.
  }
  return { count, index };
}
