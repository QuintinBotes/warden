import type { BrowserEngine } from './browser';
import type { ChangeSurface } from './change-surface';
import type { WardenConfig } from './config';

/**
 * Visual regression contracts. The engine renders a matrix of checks (module × viewport × theme),
 * diffs each against a Git-versioned baseline, and — in AI mode — asks the provider to classify a
 * pixel-confirmed change as meaningful vs render-noise. Results flow into the gate, reporter, and
 * dashboard as CTRF + VisualFinding[], exactly like any other tier. `@warden/visual` implements these.
 */

/** One point in the capture matrix: what to render, at which viewport and theme. */
export interface VisualCheck {
  module: string; // e.g. 'apps/checkout'
  url: string; // preview URL for that module's route
  viewport: { name: string; width: number; height: number };
  theme: 'light' | 'dark';
  /** CSS selectors whose regions are masked (dynamic content: clocks, avatars, ads). */
  mask?: string[];
}

/** A captured render: raw PNG bytes plus geometry. Bytes stay in-memory so tests need no fs. */
export interface VisualShot {
  check: VisualCheck;
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * Deterministic screenshot seam (sibling to `BrowserEngine`). The Playwright-backed
 * implementation disables animations, quiesces fonts/network, applies the color-scheme +
 * viewport, masks dynamic regions, then screenshots — so re-running the same commit is stable.
 */
export interface VisualEngine {
  name: string; // 'playwright-visual'
  capture(check: VisualCheck): Promise<VisualShot>;
  close(): Promise<void>;
}

export interface VisualBaselineKey {
  module: string;
  viewport: string;
  theme: 'light' | 'dark';
}

export interface VisualBaseline {
  key: VisualBaselineKey;
  path: string; // repo-relative PNG path
  width: number;
  height: number;
  sourceSha: string; // commit the baseline was captured from
  approvedBy?: string; // who blessed it (audit trail)
  approvedAt?: string; // ISO timestamp
}

/** Git-versioned baseline storage, backed by files under `visual.baselinesDir` + a manifest. */
export interface VisualBaselineStore {
  get(key: VisualBaselineKey): Promise<VisualBaseline | null>;
  read(baseline: VisualBaseline): Promise<Uint8Array>;
  /** Write a candidate as a *pending* baseline (uncommitted) for a new or changed check. */
  putPending(key: VisualBaselineKey, shot: VisualShot, sourceSha: string): Promise<VisualBaseline>;
  /** Promote a pending/candidate to the committed baseline; records `approvedBy`. */
  approve(key: VisualBaselineKey, approvedBy: string): Promise<VisualBaseline>;
  list(module?: string): Promise<VisualBaseline[]>;
}

/** Deterministic pixel comparison — a pure function; the noise floor under the AI judge. */
export interface PixelDiffResult {
  changedRatio: number; // 0..1 of pixels beyond the anti-alias tolerance
  diffPng: Uint8Array; // highlighted diff image, for the triptych
  boundingBoxes: { x: number; y: number; w: number; h: number }[]; // clustered change regions
}

/** The structure-aware judgment (AI mode). Classifies a *pixel-confirmed* change. */
export interface VisualJudgment {
  classification: 'meaningful' | 'render-noise';
  confidence: number; // 0..1
  rationale: string; // one line surfaced to the reviewer
}

export interface VisualJudge {
  judge(input: {
    check: VisualCheck;
    baseline: Uint8Array;
    candidate: Uint8Array;
    pixel: PixelDiffResult;
  }): Promise<VisualJudgment>;
}

/** Per-check outcome. `VISUAL_DIFF` is the new visual status role that feeds the gate. */
export type VisualStatus = 'MATCH' | 'VISUAL_DIFF' | 'NEW_BASELINE';

export interface VisualComparison {
  check: VisualCheck;
  status: VisualStatus;
  changedRatio: number;
  judgment?: VisualJudgment; // present only in AI mode when pixels changed
  baselinePath?: string;
  candidatePath: string; // written under artifactsDir for replay
  diffPath?: string;
}

/** A visual regression surfaced in the PR comment + dashboard (sibling to `ExploratoryFinding`). */
export interface VisualFinding {
  module: string;
  viewport: string;
  theme: 'light' | 'dark';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  changedRatio: number;
  rationale?: string; // from the judge in AI mode
  baselinePath?: string;
  candidatePath: string;
  diffPath?: string;
}

/** Plans the capture matrix from the change surface + config (only touched modules). */
export type PlanVisualChecks = (
  changeSurface: ChangeSurface,
  cfg: WardenConfig,
  resolveUrl: (module: string) => string,
) => VisualCheck[];

/** Factory: wrap the already-selected `BrowserEngine` in a deterministic `VisualEngine`. */
export type VisualEngineFactory = (
  engine: BrowserEngine,
  visual: WardenConfig['visual'],
) => VisualEngine;
