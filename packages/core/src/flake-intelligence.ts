import { z } from 'zod';
import type { TestResult } from './schema';
import type { FailureContext } from './agent';
import type { LLMProvider } from './llm';
import type { WardenConfig } from './config';
import type { FlakeStat, DashboardDataApi, TrendPoint } from './v2';

/**
 * Flaky-test intelligence contracts. Layered on top of V1 quarantine: a retry policy, an
 * LLM root-cause classifier, quantified flake impact, and trend history. `@warden/test-management`,
 * `@warden/agent`, and `@warden/dashboard-api` implement these.
 */

export const FlakeRootCause = z.enum(['timing', 'selector', 'data', 'network', 'unknown']);
export type FlakeRootCause = z.infer<typeof FlakeRootCause>;

export interface FlakeClassification {
  testCaseId: string;
  rootCause: FlakeRootCause;
  confidence: number; // 0-1
  explanation: string;
  classifiedAt: Date;
}

/** What the classifier receives: recent chronological history plus the last failing attempt. */
export interface FlakeClassifierInput {
  testCaseId: string;
  recentResults: TestResult[]; // chronological, most recent last
  latestFailure: FailureContext;
}

export interface FlakeClassifier {
  classify(
    input: FlakeClassifierInput,
    provider: LLMProvider,
    cfg: WardenConfig,
  ): Promise<FlakeClassification>;
}

/** Quantified cost of a test's flakiness — Currents' "Flakiness Impact" analog. */
export interface FlakeImpact {
  testCaseId: string;
  reRunsCaused: number; // retry attempts this test triggered across recent executions
  ciMinutesLost: number; // sum of retry-attempt durations, converted to minutes
  gateBlocksAvoided: number; // executions that would have BLOCKed without the retry pass
}

export interface FlakeTrendPoint {
  at: Date;
  flakeRate: number; // fraction of results flaky/retried-to-pass in the window ending `at`
  newlyFlagged: number; // tests newly quarantined in the window
  deflaked: number; // tests whose quarantine cleared in the window
}

/** One row of the dashboard's flake board — additive superset of the existing `FlakeStat`. */
export interface FlakeBoardEntry extends FlakeStat {
  impact: FlakeImpact;
  rootCause?: FlakeRootCause;
  mttrHours?: number; // time from first-quarantined to cleared, for the most recent episode
}

/** Additive dashboard surface; a `DashboardDataApi` implementation may also implement this. */
export interface FlakeIntelligenceDataApi extends DashboardDataApi {
  flakeBoardDetailed(): Promise<FlakeBoardEntry[]>;
  topOffenders(n: number): Promise<FlakeBoardEntry[]>;
  flakeTrend(range: { from: Date; to: Date }): Promise<FlakeTrendPoint[]>;
}

export type { TrendPoint };
