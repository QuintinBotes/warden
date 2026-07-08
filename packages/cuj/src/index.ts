import type {
  CujHealthReport,
  CujSignal,
  Cuj,
  ChangeSurface,
  GateDecision,
  TestResult,
  WardenConfig,
} from '@warden/core';
import type { CujParse, CujSource, ExecutionHistory } from './ports.js';
import { CujRegistry, type CujRegistryResult } from './registry.js';
import { resolveTouchedCujs } from './resolve-touched.js';
import { computeCujHealth } from './health.js';
import { resolveCujBaseline } from './baseline.js';
import { evaluateCujGate } from './gate.js';
import { projectCujBoard } from './board.js';

export type { CujSource, ExecutionHistory, CujParse } from './ports.js';
export { CujRegistry, tagsOf, type CujRegistryResult } from './registry.js';
export { resolveTouchedCujs } from './resolve-touched.js';
export { computeCujHealth, worstStatus, statusSeverity } from './health.js';
export { resolveCujBaseline } from './baseline.js';
export { evaluateCujGate, mergeGateDecisions } from './gate.js';
export { projectCujBoard } from './board.js';
export { renderCujMissionBrief, MISSION_BRIEF_MAX_CHARS } from './mission-brief.js';

/** Everything the engine needs, every IO collaborator injected. */
export interface CujEngineIo {
  source: CujSource;
  history?: ExecutionHistory;
  /** YAML parser (CLI injects `js-yaml`'s `load`; defaults to `JSON.parse`). */
  parse?: CujParse;
  /** Injected clock so `computedAt` is deterministic in tests. */
  now?: () => Date;
}

/**
 * A thin façade over the pure units, wired from injected IO. Mirrors `createProvider` /
 * `createEngine` in sibling packages: hand it the ports and it exposes the CUJ pipeline
 * (load → resolve touched → health → baseline → gate → board) with the collaborators bound.
 */
export interface CujEngine {
  loadCujs(dir: string): Promise<CujRegistryResult>;
  resolveTouched(surface: ChangeSurface, cujs: Cuj[]): ReturnType<typeof resolveTouchedCujs>;
  computeHealth(cuj: Cuj, latestResults: TestResult[], signals?: CujSignal[]): CujHealthReport;
  resolveBaseline(
    touched: ReturnType<typeof resolveTouchedCujs>,
    baseRef: string,
    signalsByCuj?: Record<string, CujSignal[]>,
  ): Promise<CujHealthReport[]>;
  evaluateGate(input: {
    touched: ReturnType<typeof resolveTouchedCujs>;
    before: CujHealthReport[];
    after: CujHealthReport[];
    cfg: WardenConfig;
  }): GateDecision;
  projectBoard(
    cujs: Cuj[],
    resultsFor: (cuj: Cuj) => TestResult[],
    signalsByCuj?: Record<string, CujSignal[]>,
  ): CujHealthReport[];
}

export function createCujEngine(io: CujEngineIo): CujEngine {
  const registry = new CujRegistry(io.source, io.parse);
  const now = io.now ?? (() => new Date());

  return {
    loadCujs: (dir) => registry.load(dir),
    resolveTouched: (surface, cujs) => resolveTouchedCujs(surface, cujs),
    computeHealth: (cuj, latestResults, signals) =>
      computeCujHealth(cuj, latestResults, signals, { now: now() }),
    resolveBaseline: async (touched, baseRef, signalsByCuj) => {
      if (!io.history) {
        throw new Error('createCujEngine: resolveBaseline requires an injected `history` port.');
      }
      return resolveCujBaseline(touched, baseRef, io.history, { signalsByCuj, now: now() });
    },
    evaluateGate: (input) => evaluateCujGate(input),
    projectBoard: (cujs, resultsFor, signalsByCuj) =>
      projectCujBoard(cujs, resultsFor, { signalsByCuj, now: now() }),
  };
}
