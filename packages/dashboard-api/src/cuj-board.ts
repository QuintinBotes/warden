import type { SqliteStore } from '@warden/test-management';
import { projectCujBoard } from '@warden/cuj';
import type { Cuj, CujBoardApi, CujHealthReport, CujSignal, TestResult } from '@warden/core';

/**
 * How many recent executions to scan per test case when finding its "last result". Matches the
 * bound `SqliteDashboardApi` uses — generous enough for a demo-scale history, cheap to query.
 */
const RECENT_HISTORY_LIMIT = 1000;

/**
 * `CujBoardApi` implemented over the same `@warden/test-management` `SqliteStore` the existing
 * dashboard API uses. The CUJ definitions are supplied by the caller (loaded via
 * `CujRegistry` in `@warden/cli`); for each CUJ, the latest result of every linked test is read
 * from the store and rolled up with the pure `projectCujBoard` engine. Additive by construction —
 * it implements a small sibling interface and never touches `DashboardDataApi`.
 */
export class SqliteCujBoardApi implements CujBoardApi {
  constructor(
    private readonly store: SqliteStore,
    private readonly cujs: Cuj[],
    private readonly signalsByCuj: Record<string, CujSignal[]> = {},
  ) {}

  async cujBoard(): Promise<CujHealthReport[]> {
    return projectCujBoard(this.cujs, (cuj) => this.latestResultsFor(cuj), {
      signalsByCuj: this.signalsByCuj,
    });
  }

  /** The most-recent stored result for each of the CUJ's linked test cases. */
  private latestResultsFor(cuj: Cuj): TestResult[] {
    const testIds = new Set<string>();
    for (const step of cuj.steps) for (const id of step.testIds) testIds.add(id);

    const results: TestResult[] = [];
    for (const id of testIds) {
      const history = this.store.getRecentExecutions(id, RECENT_HISTORY_LIMIT);
      const latest = history[0]; // getRecentExecutions returns most-recent-first
      if (latest) results.push(latest);
    }
    return results;
  }
}
