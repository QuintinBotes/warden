import { WardenError, type CoverageIndex, type CoverageIndexEntry } from '@warden/core';

/**
 * Parse + validate a coverage index into the canonical {@link CoverageIndex} shape.
 *
 * Three input shapes are accepted and normalized to the same `{ testId, testName, files }[]`:
 *  1. Warden's native array: `{ testId, testName, files: string[] }[]` (`testName` optional →
 *     falls back to `testId`).
 *  2. A simple istanbul-style file→tests map: `{ [file]: { tests: string[] } }` — inverted so
 *     each test collects the files that list it.
 *  3. A test→files map: `{ [testId]: string[] }`.
 *
 * Output is deterministic: entries sorted by `testId`, each entry's `files` deduped + sorted.
 * Malformed input throws a {@link WardenError} (`code: 'E_IMPACT_INDEX'`).
 */
export function loadCoverageIndex(raw: string): CoverageIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new WardenError(
      `Coverage index is not valid JSON: ${(err as Error).message}`,
      'E_IMPACT_INDEX',
    );
  }
  return normalize(parsed);
}

/** Minimal injected read access — the subset of `@warden/core`'s `FileAccess` the loader needs. */
export interface CoverageFileAccess {
  readFile(path: string): Promise<string | null>;
}

/**
 * Read + parse a coverage index from `path` over injected file access. Throws a {@link WardenError}
 * when the file is absent (`readFile` returns `null`) or malformed.
 */
export async function readCoverageIndex(
  path: string,
  fileAccess: CoverageFileAccess,
): Promise<CoverageIndex> {
  const raw = await fileAccess.readFile(path);
  if (raw == null) {
    throw new WardenError(`Coverage index not found at '${path}'.`, 'E_IMPACT_INDEX');
  }
  return loadCoverageIndex(raw);
}

// ── internals ──────────────────────────────────────────────────────────────────────────────

interface Accum {
  testName: string;
  files: Set<string>;
}

function normalize(parsed: unknown): CoverageIndex {
  const byTest = new Map<string, Accum>();

  if (Array.isArray(parsed)) {
    parsed.forEach((item, i) => absorbNativeEntry(byTest, item, i));
  } else if (isRecord(parsed)) {
    for (const [key, value] of Object.entries(parsed)) absorbMapEntry(byTest, key, value);
  } else {
    throw new WardenError(
      'Coverage index must be an array of entries or a file/test map object.',
      'E_IMPACT_INDEX',
    );
  }

  return finalize(byTest);
}

/** One element of the native `{ testId, testName, files }[]` shape. */
function absorbNativeEntry(byTest: Map<string, Accum>, item: unknown, i: number): void {
  if (!isRecord(item)) {
    throw new WardenError(`Coverage index entry #${i} must be an object.`, 'E_IMPACT_INDEX');
  }
  const { testId, testName, files } = item;
  if (typeof testId !== 'string' || testId.length === 0) {
    throw new WardenError(
      `Coverage index entry #${i} is missing a non-empty string 'testId'.`,
      'E_IMPACT_INDEX',
    );
  }
  if (!isStringArray(files)) {
    throw new WardenError(
      `Coverage index entry #${i} ('${testId}') must have a string[] 'files'.`,
      'E_IMPACT_INDEX',
    );
  }
  const name = typeof testName === 'string' && testName.length > 0 ? testName : testId;
  merge(byTest, testId, name, files);
}

/** One `[key, value]` of an object-map shape (either file→{tests} or testId→files). */
function absorbMapEntry(byTest: Map<string, Accum>, key: string, value: unknown): void {
  if (isStringArray(value)) {
    // testId → files
    merge(byTest, key, key, value);
    return;
  }
  if (isRecord(value) && isStringArray(value.tests)) {
    // file → { tests: string[] }; invert so each test collects this file
    for (const testId of value.tests) {
      if (testId.length > 0) merge(byTest, testId, testId, [key]);
    }
    return;
  }
  throw new WardenError(
    `Coverage index map value for '${key}' must be a string[] of files or an object with a string[] 'tests'.`,
    'E_IMPACT_INDEX',
  );
}

function merge(
  byTest: Map<string, Accum>,
  testId: string,
  testName: string,
  files: string[],
): void {
  const existing = byTest.get(testId);
  if (existing) {
    for (const f of files) existing.files.add(f);
    return;
  }
  byTest.set(testId, { testName, files: new Set(files) });
}

function finalize(byTest: Map<string, Accum>): CoverageIndex {
  return [...byTest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([testId, { testName, files }]): CoverageIndexEntry => ({
      testId,
      testName,
      files: [...files].sort(),
    }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
