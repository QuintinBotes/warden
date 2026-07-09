/**
 * Linear-time string helpers that replace backtracking-prone regexes (CodeQL js/polynomial-redos).
 * A regex like `/\/+$/` or `/^-+|-+$/` can run in quadratic time on hostile input; these scan once.
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
