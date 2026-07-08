import type { FileAccess, LocatorRef, TestCase } from '@warden/core';

/**
 * Scans the spec files of the given (already affected-scoped) test cases for the role/label
 * locator call sites Warden can mechanically re-resolve:
 *
 * - `page.getByRole('button', { name: 'Buy' })` / `getByRole(...)` → `click` locator
 * - `session.click('button', 'Buy')`                              → `click` locator
 * - `page.getByLabel('Email')` / `getByLabel(...)`                → `fill` locator (role `'label'`)
 * - `session.fill('Email', 'x')`                                  → `fill` locator (role `'label'`)
 *
 * Only string-literal locators are extracted — a dynamic `name` (a variable, template
 * interpolation, etc.) is skipped, because it can't be mechanically re-resolved or patched.
 * Every ref carries its 1-based source line and the owning `testCaseId`. Pure over the injected
 * {@link FileAccess}; no browser, no network.
 */
export async function extractLocators(
  testCases: TestCase[],
  fileAccess: FileAccess,
): Promise<LocatorRef[]> {
  // First test case that references a spec file owns it, so a file is scanned exactly once.
  const owners = new Map<string, string>();
  for (const tc of testCases) {
    const filePath = tc.automation.filePath;
    if (!filePath) continue;
    if (!owners.has(filePath)) owners.set(filePath, tc.id);
  }

  const refs: LocatorRef[] = [];
  for (const [filePath, testCaseId] of owners) {
    const source = await fileAccess.readFile(filePath);
    if (source === null) continue;
    for (const ref of scanSource(source, filePath, testCaseId)) refs.push(ref);
  }
  return refs;
}

interface RawMatch {
  index: number;
  kind: LocatorRef['kind'];
  role: string;
  name: string;
}

// `getByRole('role', { name: 'accessible name' })` — role in g2, name in g4. `[\s\S]*?` spans
// newlines and extra options (e.g. `exact: true`) between the role arg and the `name` key.
const GET_BY_ROLE = /getByRole\(\s*(['"`])(.+?)\1\s*,\s*\{[\s\S]*?\bname\s*:\s*(['"`])(.+?)\3/g;
// `getByLabel('label')` — label text in g2.
const GET_BY_LABEL = /getByLabel\(\s*(['"`])(.+?)\1/g;
// Warden `BrowserSession.click(role, name)` — two string args. `getByRole(...).click()` (empty
// args) never matches this two-arg form, so the two extractors don't double-count a Playwright call.
const SESSION_CLICK = /\bclick\(\s*(['"`])(.+?)\1\s*,\s*(['"`])(.+?)\3\s*\)/g;
// Warden `BrowserSession.fill(label, value)` — two string args; label in g2, value ignored.
const SESSION_FILL = /\bfill\(\s*(['"`])(.+?)\1\s*,\s*(['"`])(.+?)\3\s*\)/g;

function scanSource(source: string, filePath: string, testCaseId: string): LocatorRef[] {
  const matches: RawMatch[] = [];

  collect(source, GET_BY_ROLE, (m) => ({ kind: 'click', role: m[2]!, name: m[4]! }), matches);
  collect(source, GET_BY_LABEL, (m) => ({ kind: 'fill', role: 'label', name: m[2]! }), matches);
  collect(source, SESSION_CLICK, (m) => ({ kind: 'click', role: m[2]!, name: m[4]! }), matches);
  collect(source, SESSION_FILL, (m) => ({ kind: 'fill', role: 'label', name: m[2]! }), matches);

  // Deterministic order: by source position, then dedupe identical call sites.
  matches.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const refs: LocatorRef[] = [];
  for (const m of matches) {
    const key = `${m.index}:${m.kind}:${m.role}:${m.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      filePath,
      line: lineOf(source, m.index),
      testCaseId,
      kind: m.kind,
      role: m.role,
      name: m.name,
    });
  }
  return refs;
}

function collect(
  source: string,
  pattern: RegExp,
  map: (m: RegExpExecArray) => Omit<RawMatch, 'index'>,
  out: RawMatch[],
): void {
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    out.push({ index: m.index, ...map(m) });
  }
}

/** 1-based line number of a character offset. */
function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}
