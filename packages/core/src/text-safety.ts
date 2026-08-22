/**
 * String helpers for the places where a regex is the hazard rather than the tool.
 *
 * Two hazards live here. Linear-time replacements for backtracking-prone regexes (CodeQL
 * js/polynomial-redos): a regex like `/\/+$/` or `/^-+|-+$/` can run in quadratic time on hostile
 * input, and these scan once. And {@link escapeRegExp}, for the opposite direction — a literal
 * string about to be compiled as a pattern by something downstream.
 */

/** Strip trailing `/` characters in linear time (safe replacement for `.replace(/\/+$/, '')`). */
export function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

/**
 * Slugify in linear time: runs of non-alphanumerics collapse to a single `-`, and leading/trailing
 * separators are trimmed. Case is preserved. Safe replacement for
 * `.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')`.
 */
export function slugify(s: string): string {
  const out: string[] = [];
  let pendingSep = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (alnum) {
      if (pendingSep && out.length > 0) out.push('-');
      pendingSep = false;
      out.push(s[i]!);
    } else {
      pendingSep = true;
    }
  }
  return out.join('');
}

/**
 * Escape a literal string so it matches only itself when compiled as a regex.
 *
 * Test titles are literals that end up inside patterns: Playwright compiles `--grep` as a RegExp,
 * so `checkout [beta]` unescaped is a character class that no longer matches the test it names, and
 * an unbalanced `[` or `(` is not a regex at all. Every caller that joins names into a `--grep`
 * alternation goes through this — one escape, so a fix here is a fix everywhere.
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape a string so it survives inside a Markdown table cell.
 *
 * Order is the whole of it: backslashes first, then pipes. Escaping the pipe first turns an
 * input that already contains `\\|` into `\\\\|` — Markdown renders the pair as one literal
 * backslash and the pipe that follows ends the row, so a message containing a Windows path or a
 * regex breaks the table it was supposed to sit in. That is CodeQL's
 * js/incomplete-sanitization, and `packages/github-action/src/report.ts` shipped it by
 * hand-rolling the pair in the wrong order while two correct copies already existed elsewhere.
 * Newlines collapse to a space for the same reason: a bare newline ends the row.
 */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
