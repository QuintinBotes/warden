import {
  computeFlakeImpact,
  computeFlakeRate,
  computeMttrToDeflake,
  shouldQuarantine,
  type SqliteStore,
} from '@warden/test-management';
import type {
  CoverageCell,
  CoverageFilter,
  DashboardDataApi,
  DateRange,
  FlakeBoardEntry,
  FlakeIntelligenceDataApi,
  FlakeStat,
  FlakeTrendPoint,
  Requirement,
  TestExecution,
  TrendMetric,
  TrendPoint,
} from '@warden/core';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many recent executions to pull per test case when computing "last result" /
 * flake history. `SqliteStore#getRecentExecutions` is bounded by execution count (not
 * time), so this needs to be generous enough to cover a realistic history window for a
 * demo-scale dataset while staying cheap to query.
 */
const RECENT_HISTORY_LIMIT = 1000;

/** Requirement ids follow a `REQ-<MODULE>-NNN` convention; matching is a case-insensitive substring check. */
function matchesModule(requirement: Requirement, module: string): boolean {
  return requirement.id.toUpperCase().includes(module.toUpperCase());
}

/** All distinct test case ids referenced by any requirement's `linkedTestIds`. */
function collectTestCaseIds(requirements: Requirement[]): string[] {
  const ids = new Set<string>();
  for (const req of requirements) {
    for (const id of req.linkedTestIds) ids.add(id);
  }
  return [...ids];
}

function computeMetricValue(
  metric: TrendMetric,
  execution: TestExecution,
  universeTestCaseIds: string[],
): number {
  const results = execution.results;
  switch (metric) {
    case 'passRate': {
      if (results.length === 0) return 0;
      const passed = results.filter((r) => r.status === 'PASS').length;
      return passed / results.length;
    }
    case 'flakeRate': {
      if (results.length === 0) return 0;
      const flaky = results.filter((r) => r.status === 'FLAKY' || r.flakeFlag).length;
      return flaky / results.length;
    }
    case 'mttr': {
      const failed = results.filter((r) => r.status === 'FAIL');
      if (failed.length === 0) return 0;
      const totalDuration = failed.reduce((sum, r) => sum + r.duration, 0);
      return totalDuration / failed.length;
    }
    case 'coverage': {
      if (universeTestCaseIds.length === 0) return 0;
      const coveredInExecution = new Set(results.map((r) => r.testCaseId));
      const covered = universeTestCaseIds.filter((id) => coveredInExecution.has(id)).length;
      return covered / universeTestCaseIds.length;
    }
    case 'suiteDuration': {
      return results.reduce((sum, r) => sum + r.duration, 0);
    }
    default: {
      const exhaustive: never = metric;
      throw new Error(`Unknown trend metric: ${String(exhaustive)}`);
    }
  }
}

/**
 * `DashboardDataApi` implemented over a `@warden/test-management` `SqliteStore`. Requirements
 * and their `linkedTestIds` define the universe of tracked test cases (the store has no
 * separate test-case table); coverage and flake data are derived from each test case's
 * execution history via `getRecentExecutions`.
 */
export class SqliteDashboardApi implements DashboardDataApi, FlakeIntelligenceDataApi {
  constructor(private readonly store: SqliteStore) {}

  async listRequirements(filter?: CoverageFilter): Promise<Requirement[]> {
    let requirements = this.store.getRequirements();
    if (filter?.module) {
      const module = filter.module;
      requirements = requirements.filter((r) => matchesModule(r, module));
    }
    if (filter?.status) {
      const status = filter.status;
      requirements = requirements.filter((r) => r.coverageStatus === status);
    }
    return requirements;
  }

  async coverageMatrix(): Promise<CoverageCell[]> {
    const requirements = this.store.getRequirements();
    const cells: CoverageCell[] = [];
    for (const req of requirements) {
      for (const testCaseId of req.linkedTestIds) {
        const history = this.store.getRecentExecutions(testCaseId, RECENT_HISTORY_LIMIT);
        const last = history[0];
        cells.push({
          requirementId: req.id,
          testCaseId,
          lastResult: last ? last.status : null,
        });
      }
    }
    return cells;
  }

  async executions(range: DateRange): Promise<TestExecution[]> {
    return this.store.listExecutions({ from: range.from, to: range.to });
  }

  async flakeBoard(): Promise<FlakeStat[]> {
    const testCaseIds = collectTestCaseIds(this.store.getRequirements());
    return testCaseIds.map((testCaseId) => {
      const history = this.store.getRecentExecutions(testCaseId, RECENT_HISTORY_LIMIT);
      const flakeRate = computeFlakeRate(history);
      return { testCaseId, flakeRate, quarantined: shouldQuarantine(flakeRate) };
    });
  }

  async trends(metric: TrendMetric, range: DateRange): Promise<TrendPoint[]> {
    const executionsInRange = await this.executions(range);
    const universeTestCaseIds = collectTestCaseIds(this.store.getRequirements());
    return executionsInRange.map((execution) => ({
      at: execution.startedAt,
      value: computeMetricValue(metric, execution, universeTestCaseIds),
    }));
  }

  /**
   * The flake board widened with quantified impact, the latest root-cause classification, and the
   * most recent episode's MTTR-to-deflake per test case — a superset of {@link flakeBoard}.
   */
  async flakeBoardDetailed(): Promise<FlakeBoardEntry[]> {
    const base = await this.flakeBoard();
    const events = this.store.listQuarantineEvents();
    return base.map((stat) => {
      const history = this.store.getRecentExecutions(stat.testCaseId, RECENT_HISTORY_LIMIT);
      const entry: FlakeBoardEntry = {
        ...stat,
        impact: computeFlakeImpact(stat.testCaseId, history),
      };
      const classification = this.store.getFlakeClassification(stat.testCaseId);
      if (classification) entry.rootCause = classification.rootCause;
      const mttrHours = computeMttrToDeflake(events, stat.testCaseId);
      if (mttrHours !== undefined) entry.mttrHours = mttrHours;
      return entry;
    });
  }

  /** The `n` test cases with the most CI time lost to flakiness, most-costly first. */
  async topOffenders(n: number): Promise<FlakeBoardEntry[]> {
    const detailed = await this.flakeBoardDetailed();
    return detailed
      .slice()
      .sort((a, b) => b.impact.ciMinutesLost - a.impact.ciMinutesLost)
      .slice(0, Math.max(0, n));
  }

  /**
   * Flake rate over time, bucketed by UTC day across the executions in `range`. Each point's rate
   * is the fraction of results that flaked (FLAKY status or `flakeFlag`) that day; `newlyFlagged`
   * and `deflaked` count the quarantine/clear events recorded that day.
   */
  async flakeTrend(range: { from: Date; to: Date }): Promise<FlakeTrendPoint[]> {
    const executions = this.store.listExecutions({ from: range.from, to: range.to });
    const events = this.store.listQuarantineEvents();

    const buckets = new Map<string, { flaky: number; total: number }>();
    for (const execution of executions) {
      const day = execution.startedAt.toISOString().slice(0, 10);
      const bucket = buckets.get(day) ?? { flaky: 0, total: 0 };
      for (const r of execution.results) {
        bucket.total += 1;
        if (r.status === 'FLAKY' || r.flakeFlag) bucket.flaky += 1;
      }
      buckets.set(day, bucket);
    }

    return [...buckets.keys()].sort().map((day) => {
      const bucket = buckets.get(day) ?? { flaky: 0, total: 0 };
      const at = new Date(`${day}T00:00:00.000Z`);
      const start = at.getTime();
      const inDay = (d: Date): boolean => d.getTime() >= start && d.getTime() < start + DAY_MS;
      return {
        at,
        flakeRate: bucket.total > 0 ? bucket.flaky / bucket.total : 0,
        newlyFlagged: events.filter((e) => e.event === 'quarantined' && inDay(e.at)).length,
        deflaked: events.filter((e) => e.event === 'cleared' && inDay(e.at)).length,
      };
    });
  }
}
