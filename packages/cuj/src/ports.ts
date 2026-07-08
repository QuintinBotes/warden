import type { TestResult } from '@warden/core';

/**
 * The two minimal injected seams that keep the CUJ engine hermetic. Both have a real
 * implementation in `@warden/cli` (fs + `SqliteStore`); every unit test injects a
 * hand-written in-memory fake, so no unit ever touches the filesystem, a database, or the
 * network.
 */

/** Read access to the CUJ YAML definitions (fs in prod, an in-memory map in tests). */
export interface CujSource {
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

/** The base-branch results the baseline resolver needs — a subset of `SqliteStore`. */
export interface ExecutionHistory {
  /** Latest result per test case on `ref`, restricted to `testIds`. */
  latestForRef(ref: string, testIds: string[]): Promise<TestResult[]>;
}

/**
 * How the registry turns raw YAML text into an object graph. Injected so `@warden/cuj` carries
 * no YAML dependency of its own — the CLI injects `js-yaml`'s `load`, and tests inject
 * `JSON.parse` (JSON is a strict subset of YAML) or a hand-written fake.
 */
export type CujParse = (raw: string) => unknown;
