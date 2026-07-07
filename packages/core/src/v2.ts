import { z } from 'zod';
import type { LLMProvider, ProviderFactory } from './llm';
import type { WardenConfig } from './config';
import type { GateDecision } from './change-surface';
import type { Requirement, CoverageStatus, TestExecution, TestStatus } from './schema';
import { ProviderError } from './errors';

/**
 * V2 contract surface — additive extensions to `@warden/core`. Nothing here changes a V1
 * signature; V2 packages implement these seams. Kept in one module so the additive nature
 * is obvious and easy to review.
 */

// ── Provider registry (WS2-10): turns the V1 factory into a pluggable registry ──────
export interface ProviderRegistry {
  register(name: string, factory: ProviderFactory): void;
  create(cfg: WardenConfig['ai']): LLMProvider;
}

export function createProviderRegistry(): ProviderRegistry {
  const factories = new Map<string, ProviderFactory>();
  return {
    register(name, factory) {
      factories.set(name, factory);
    },
    create(cfg) {
      const factory = factories.get(cfg.provider);
      if (!factory) {
        throw new ProviderError(`No provider registered for "${cfg.provider}"`);
      }
      return factory(cfg);
    },
  };
}

// ── Observability (WS2-12) ──────────────────────────────────────────────────────────
export interface MetricsEmitter {
  emitExecution(execution: TestExecution): Promise<void>;
  emitGate(decision: GateDecision, meta: { pr?: number; module?: string }): Promise<void>;
}

// ── Dashboard data API (WS2-20/21) ───────────────────────────────────────────────────
export interface DateRange {
  from: Date;
  to: Date;
}
export interface CoverageFilter {
  module?: string;
  status?: CoverageStatus;
}
export interface CoverageCell {
  requirementId: string;
  testCaseId: string;
  lastResult: TestStatus | null;
}
export interface FlakeStat {
  testCaseId: string;
  flakeRate: number;
  quarantined: boolean;
}
export type TrendMetric = 'passRate' | 'flakeRate' | 'mttr' | 'coverage' | 'suiteDuration';
export interface TrendPoint {
  at: Date;
  value: number;
}
export interface DashboardDataApi {
  listRequirements(filter?: CoverageFilter): Promise<Requirement[]>;
  coverageMatrix(): Promise<CoverageCell[]>;
  executions(range: DateRange): Promise<TestExecution[]>;
  flakeBoard(): Promise<FlakeStat[]>;
  trends(metric: TrendMetric, range: DateRange): Promise<TrendPoint[]>;
}

// ── Issue-tracker sync (WS2-13) ───────────────────────────────────────────────────────
export interface IntegrationAdapter {
  name: 'linear' | 'jira' | 'github-projects';
  fetchRequirements(): Promise<Requirement[]>;
  pushResult(requirementId: string, status: CoverageStatus): Promise<void>;
}

// ── Session recording → tests (WS2-14) ────────────────────────────────────────────────
export interface RecordedStep {
  action: string;
  selector?: string;
  value?: string;
}
export interface RecordedSession {
  url: string;
  startedAt: Date;
  steps: RecordedStep[];
}
export interface GeneratedTest {
  path: string;
  content: string;
  tags: string[];
}
export interface SessionRecorder {
  record(url: string, opts?: { maxSteps?: number }): Promise<RecordedSession>;
}
export interface TestSynthesizer {
  synthesize(session: RecordedSession, provider: LLMProvider): Promise<GeneratedTest[]>;
}

// ── Learning Content Studio (WS2-19) ──────────────────────────────────────────────────
export const LearningChapterSchema = z.object({
  title: z.string(),
  atMs: z.number(),
});

export const LearningModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceExecutionId: z.string(),
  flow: z.string(),
  script: z.string(), // AI-authored narration / steps
  chapters: z.array(LearningChapterSchema).default([]),
  videoPath: z.string().optional(),
  transcriptPath: z.string().optional(),
  articlePath: z.string().optional(),
  embedId: z.string(), // stable id for embedding in the learning platform
});
export type LearningModule = z.infer<typeof LearningModuleSchema>;

export interface LearningContentGenerator {
  /** No-op unless `cfg.learningContent.enabled`. Consumes captured E2E media on the execution. */
  generate(
    execution: TestExecution,
    provider: LLMProvider,
    cfg: WardenConfig,
  ): Promise<LearningModule[]>;
}
