import type { DashboardDataApi, DateRange, SharedRunSummary, TestExecution } from '@warden/core';
import { toSharedRunSummary } from './run-view.js';

/** Read-only facade over the injected {@link DashboardDataApi}, shaped for the results service. */
export interface ResultsFacade {
  /** List runs in `range` as shared summaries. */
  listRuns(range: DateRange): Promise<SharedRunSummary[]>;
  /** Fetch one execution by id, or `null` if it is not found. */
  getRun(id: string): Promise<TestExecution | null>;
}

/** The widest representable date range — used to resolve a single run by id. */
const FULL_RANGE: DateRange = { from: new Date(0), to: new Date(8_640_000_000_000_000) };

export function createResultsFacade(api: DashboardDataApi): ResultsFacade {
  return {
    async listRuns(range: DateRange): Promise<SharedRunSummary[]> {
      const executions = await api.executions(range);
      return executions.map(toSharedRunSummary);
    },

    async getRun(id: string): Promise<TestExecution | null> {
      const executions = await api.executions(FULL_RANGE);
      return executions.find((execution) => execution.id === id) ?? null;
    },
  };
}
