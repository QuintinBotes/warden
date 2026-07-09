import { describe, it, expect } from 'vitest';
import { WardenError } from '@warden/core';
import { loadCoverageIndex, readCoverageIndex } from './load-coverage-index.js';
import { memFileAccess } from './testing-fakes.js';

describe('loadCoverageIndex', () => {
  it("parses Warden's native { testId, testName, files }[] shape", () => {
    const raw = JSON.stringify([
      { testId: 'TC-a', testName: 'checkout', files: ['b.ts', 'a.ts'] },
      { testId: 'TC-b', testName: 'cart', files: ['a.ts'] },
    ]);

    expect(loadCoverageIndex(raw)).toEqual([
      { testId: 'TC-a', testName: 'checkout', files: ['a.ts', 'b.ts'] }, // files sorted
      { testId: 'TC-b', testName: 'cart', files: ['a.ts'] },
    ]);
  });

  it('defaults a missing testName to the testId', () => {
    const raw = JSON.stringify([{ testId: 'TC-a', files: ['a.ts'] }]);
    expect(loadCoverageIndex(raw)).toEqual([{ testId: 'TC-a', testName: 'TC-a', files: ['a.ts'] }]);
  });

  it('inverts a simple istanbul-style file -> { tests } map', () => {
    const raw = JSON.stringify({
      'a.ts': { tests: ['TC-a', 'TC-b'] },
      'b.ts': { tests: ['TC-a'] },
    });

    expect(loadCoverageIndex(raw)).toEqual([
      { testId: 'TC-a', testName: 'TC-a', files: ['a.ts', 'b.ts'] },
      { testId: 'TC-b', testName: 'TC-b', files: ['a.ts'] },
    ]);
  });

  it('normalizes a testId -> files map', () => {
    const raw = JSON.stringify({ 'TC-a': ['a.ts', 'b.ts'], 'TC-b': ['a.ts'] });

    expect(loadCoverageIndex(raw)).toEqual([
      { testId: 'TC-a', testName: 'TC-a', files: ['a.ts', 'b.ts'] },
      { testId: 'TC-b', testName: 'TC-b', files: ['a.ts'] },
    ]);
  });

  it('dedupes files and sorts entries by testId', () => {
    const raw = JSON.stringify([
      { testId: 'TC-z', testName: 'z', files: ['a.ts', 'a.ts'] },
      { testId: 'TC-a', testName: 'a', files: ['b.ts'] },
    ]);

    const index = loadCoverageIndex(raw);
    expect(index.map((e) => e.testId)).toEqual(['TC-a', 'TC-z']); // sorted
    expect(index.find((e) => e.testId === 'TC-z')!.files).toEqual(['a.ts']); // deduped
  });

  it('merges duplicate testIds across the native array', () => {
    const raw = JSON.stringify([
      { testId: 'TC-a', testName: 'a', files: ['a.ts'] },
      { testId: 'TC-a', testName: 'a', files: ['b.ts'] },
    ]);
    expect(loadCoverageIndex(raw)).toEqual([
      { testId: 'TC-a', testName: 'a', files: ['a.ts', 'b.ts'] },
    ]);
  });

  it('returns an empty index for an empty array or empty object', () => {
    expect(loadCoverageIndex('[]')).toEqual([]);
    expect(loadCoverageIndex('{}')).toEqual([]);
  });

  it('throws a WardenError on invalid JSON', () => {
    expect(() => loadCoverageIndex('not json')).toThrow(WardenError);
    try {
      loadCoverageIndex('not json');
    } catch (err) {
      expect((err as WardenError).code).toBe('E_IMPACT_INDEX');
    }
  });

  it('throws a WardenError on a non-array, non-object top level', () => {
    expect(() => loadCoverageIndex('42')).toThrow(WardenError);
  });

  it('throws a WardenError when a native entry is missing testId', () => {
    expect(() => loadCoverageIndex(JSON.stringify([{ files: ['a.ts'] }]))).toThrow(/testId/);
  });

  it('throws a WardenError when a native entry has non-string files', () => {
    const raw = JSON.stringify([{ testId: 'TC-a', files: [1, 2] }]);
    expect(() => loadCoverageIndex(raw)).toThrow(/files/);
  });

  it('throws a WardenError on an unrecognized map value', () => {
    const raw = JSON.stringify({ 'a.ts': { notTests: [] } });
    expect(() => loadCoverageIndex(raw)).toThrow(WardenError);
  });
});

describe('readCoverageIndex', () => {
  it('reads + parses over injected file access', async () => {
    const files = { 'idx.json': JSON.stringify([{ testId: 'TC-a', files: ['a.ts'] }]) };
    const index = await readCoverageIndex('idx.json', memFileAccess(files));
    expect(index).toEqual([{ testId: 'TC-a', testName: 'TC-a', files: ['a.ts'] }]);
  });

  it('throws a WardenError when the index is absent (readFile -> null)', async () => {
    await expect(readCoverageIndex('missing.json', memFileAccess({}))).rejects.toBeInstanceOf(
      WardenError,
    );
  });
});
