import { CujSchema, type Cuj, type TestResult } from '@warden/core';
import type { CujSource, ExecutionHistory } from './ports.js';

/**
 * In-memory doubles for the CUJ engine's injected ports, used only by this package's unit tests
 * (never bundled into `dist`). Same hand-written style as `@warden/coverage-sync`'s
 * `testing-fakes`.
 */

/** A `CujSource` backed by a `path -> raw text` map. */
export function memCujSource(files: Record<string, string>): CujSource {
  const paths = Object.keys(files);
  return {
    async list(_dir: string): Promise<string[]> {
      return paths.slice().sort();
    },
    async read(path: string): Promise<string> {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        throw new Error(`memCujSource: no such file ${path}`);
      }
      return files[path]!;
    },
  };
}

/**
 * An `ExecutionHistory` backed by a `ref -> TestResult[]` map. `latestForRef` returns only the
 * results whose `testCaseId` is in the requested `testIds` set (last write wins).
 */
export function memExecutionHistory(byRef: Record<string, TestResult[]>): ExecutionHistory {
  return {
    async latestForRef(ref: string, testIds: string[]): Promise<TestResult[]> {
      const wanted = new Set(testIds);
      const latest = new Map<string, TestResult>();
      for (const result of byRef[ref] ?? []) {
        if (wanted.has(result.testCaseId)) latest.set(result.testCaseId, result);
      }
      return [...latest.values()];
    },
  };
}

/** A validated `TestResult` fixture. */
export function fixtureResult(
  testCaseId: string,
  status: TestResult['status'],
  overrides: Partial<TestResult> = {},
): TestResult {
  return {
    testCaseId,
    status,
    duration: 10,
    retries: 0,
    flakeFlag: false,
    artifacts: [],
    ...overrides,
  };
}

/** A validated `Cuj` fixture (defaults fill everything unset). */
export function fixtureCuj(overrides: Partial<Cuj> = {}): Cuj {
  return CujSchema.parse({
    id: 'CUJ-checkout',
    name: 'Guest checkout',
    owningTeam: 'payments',
    tier: 'tier1',
    tags: ['@apps/checkout'],
    steps: [
      { order: 1, name: 'Add item to cart', module: '@apps/cart', testIds: ['TC-cart'] },
      { order: 2, name: 'Pay', module: '@apps/checkout', testIds: ['TC-pay'] },
    ],
    ...overrides,
  });
}
