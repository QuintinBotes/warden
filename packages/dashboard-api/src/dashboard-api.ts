import { computeFlakeRate, shouldQuarantine, type SqliteStore } from '@warden/test-management';
import type {
  CoverageCell,
  CoverageFilter,
  DashboardDataApi,
  DateRange,
  FlakeStat,
  Requirement,
  TestExecution,
  TrendMetric,
  TrendPoint,
} from '@warden/core';

/**
 * How many recent executions to pull per test case when computing "last result" /
 * flake history. `SqliteStore#getRecentExecutions` is bounded by execution count (not
 * time), so this needs to be generous enough to cover a realistic history window for a
 * demo-scale dataset while staying cheap to query.
 */
const RECENT_HISTORY_LIMIT = 1000;

/**
 * The minimal shape of the better-sqlite3 `Database` handle that `SqliteStore` wraps.
 * `SqliteStore` does not expose a way to list *all* execution ids (only per-test-case
 * history via `getRecentExecutions`), which `executions()`/`trends()` need in order to
 * filter by date range. Rather than duplicating storage logic here, we reach into the
 * store's underlying connection (TypeScript's `private` is compile-time only) and query
 * the `executions` table directly for matching ids, then hand each id back to the
 * store's own `getExecution` for validated reconstruction. This mirrors the table/column
 * names in `@warden/test-management`'s `sqlite-store.ts`.
 */
interface RawStatementLike {
  all(...params: unknown[]): unknown[];
}
interface RawDatabaseLike {
  prepare(sql: string): RawStatementLike;
}

function rawDb(store: SqliteStore): RawDatabaseLike {
  return (store as unknown as { db: RawDatabaseLike }).db;
}

interface ExecutionIdRow {
  id: string;
}

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
export class SqliteDashboardApi implements DashboardDataApi {
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
    const rows = rawDb(this.store)
      .prepare(
        `SELECT id FROM executions WHERE startedAt >= ? AND startedAt <= ? ORDER BY startedAt ASC`,
      )
      .all(range.from.toISOString(), range.to.toISOString()) as ExecutionIdRow[];

    const result: TestExecution[] = [];
    for (const row of rows) {
      const execution = this.store.getExecution(row.id);
      if (execution) result.push(execution);
    }
    return result;
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
}
