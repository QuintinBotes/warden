import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createLogger,
  type ChangeSurface,
  type CujHealthReport,
  type CujSignal,
  type GateDecision,
  type Logger,
  type TestResult,
  type WardenConfig,
} from '@warden/core';
import {
  CujRegistry,
  computeCujHealth,
  evaluateCujGate,
  resolveCujBaseline,
  resolveTouchedCujs,
  type CujParse,
  type CujSource,
  type ExecutionHistory,
} from '@warden/cuj';

/**
 * The CLI's real filesystem `CujSource`: lists and reads the CUJ YAML defs under `cfg.cuj.dir`.
 * Injected into `CujRegistry`; tests use an in-memory fake instead.
 */
export function fsCujSource(): CujSource {
  return {
    async list(dir: string): Promise<string[]> {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile()).map((entry) => join(dir, entry.name));
      } catch {
        return []; // no CUJ dir → no CUJs; never crash the run
      }
    },
    async read(path: string): Promise<string> {
      return readFile(path, 'utf8');
    },
  };
}

/** Everything the CUJ gate needs for one run, every IO collaborator injected. */
export interface CujGateRun {
  /** Reads the CUJ YAML defs (fs in prod, an in-memory map in tests). */
  source: CujSource;
  /** Base-branch results for the baseline (a `SqliteStore` adapter in prod). Absent → no baseline. */
  history?: ExecutionHistory;
  /** The change surface this run computed, used to scope which journeys gate. */
  changeSurface: ChangeSurface;
  /** The base ref to read before-health from (e.g. `main`). Absent → no baseline. */
  baseRef?: string;
  /** YAML parser (the CLI bin injects `js-yaml`'s `load`; defaults to `JSON.parse`). */
  parse?: CujParse;
  /** Already-evaluated non-functional signals per CUJ id, if any tiers ran. */
  signalsByCuj?: Record<string, CujSignal[]>;
  now?: () => Date;
}

export interface CujGateOutcome {
  gate: GateDecision;
  /** After-health of every touched journey, for surfacing in the report/board. */
  reports: CujHealthReport[];
}

const NEUTRAL: GateDecision = { decision: 'PASS', reason: 'CUJ gate: no touched journeys.' };

/**
 * Loads the CUJ defs, scopes them to the change surface, rolls up after-health from this run's
 * results, resolves the baseline, and returns the CUJ `GateDecision` (a neutral PASS when the
 * feature is off or nothing is touched). Malformed defs are skipped with a WARN — never fatal.
 */
export async function evaluateCujGateForRun(
  results: TestResult[],
  cfg: WardenConfig,
  run: CujGateRun,
  logger: Logger = createLogger(),
): Promise<CujGateOutcome> {
  if (!cfg.cuj.enabled || !cfg.cuj.gate.enabled) {
    return { gate: NEUTRAL, reports: [] };
  }

  const { cujs, errors } = await new CujRegistry(run.source, run.parse).load(cfg.cuj.dir);
  for (const err of errors) logger.warn(`CUJ definition skipped: ${err.message}`);
  // The gate is enabled but no CUJ definitions loaded (missing/misconfigured `cuj.dir`, or every
  // def was malformed). It ran but measured nothing — WARN rather than a confident neutral PASS.
  if (cujs.length === 0) {
    return {
      gate: {
        decision: 'WARN',
        reason: `CUJ gate is enabled but no CUJ definitions were loaded from '${cfg.cuj.dir}' — journey health was not measured.`,
      },
      reports: [],
    };
  }

  const touched = resolveTouchedCujs(run.changeSurface, cujs);
  if (touched.length === 0) return { gate: NEUTRAL, reports: [] };

  const now = run.now ?? (() => new Date());
  const after = touched.map((t) =>
    computeCujHealth(t.cuj, results, run.signalsByCuj?.[t.cuj.id] ?? [], { now: now() }),
  );
  const before =
    run.baseRef && run.history
      ? await resolveCujBaseline(touched, run.baseRef, run.history, {
          signalsByCuj: run.signalsByCuj,
          now: now(),
        })
      : [];

  return { gate: evaluateCujGate({ touched, before, after, cfg }), reports: after };
}

/**
 * A `SqliteStore`-backed `ExecutionHistory`: the base ref's latest result per test case. Kept
 * structural (a `getRecentExecutions` shape) so this file takes no build-time dependency on
 * `@warden/test-management` — the CLI passes its `SqliteStore`, tests pass a fake.
 */
export function sqliteExecutionHistory(store: {
  getRecentExecutions(testCaseId: string, n: number): TestResult[];
}): ExecutionHistory {
  return {
    async latestForRef(_ref: string, testIds: string[]): Promise<TestResult[]> {
      const out: TestResult[] = [];
      for (const id of testIds) {
        const latest = store.getRecentExecutions(id, 1000)[0];
        if (latest) out.push(latest);
      }
      return out;
    },
  };
}
