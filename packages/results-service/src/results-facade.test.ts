import { describe, expect, it } from 'vitest';
import { fixtureExecution } from '@warden/core/testing';
import type {
  CoverageCell,
  DashboardDataApi,
  DateRange,
  FlakeStat,
  Requirement,
  TestExecution,
  TrendPoint,
} from '@warden/core';
import { createResultsFacade } from './results-facade.js';

/** A fully in-memory {@link DashboardDataApi} that records the ranges it was queried with. */
function fakeDashboardApi(executions: TestExecution[]): DashboardDataApi & { ranges: DateRange[] } {
  const ranges: DateRange[] = [];
  return {
    ranges,
    async executions(range: DateRange): Promise<TestExecution[]> {
      ranges.push(range);
      return executions;
    },
    async listRequirements(): Promise<Requirement[]> {
      return [];
    },
    async coverageMatrix(): Promise<CoverageCell[]> {
      return [];
    },
    async flakeBoard(): Promise<FlakeStat[]> {
      return [];
    },
    async trends(): Promise<TrendPoint[]> {
      return [];
    },
  };
}

const RANGE: DateRange = { from: new Date('2026-07-01'), to: new Date('2026-07-08') };

describe('createResultsFacade', () => {
  it('listRuns maps executions to shared summaries over the injected api', async () => {
    const api = fakeDashboardApi([
      fixtureExecution({ id: 'EX-1', triggerRef: 'PR-1' }),
      fixtureExecution({ id: 'EX-2', triggerRef: 'PR-2', results: [] }),
    ]);
    const facade = createResultsFacade(api);
    const runs = await facade.listRuns(RANGE);
    expect(runs.map((r) => r.executionId)).toEqual(['EX-1', 'EX-2']);
    expect(api.ranges).toEqual([RANGE]);
  });

  it('getRun returns the matching execution', async () => {
    const api = fakeDashboardApi([
      fixtureExecution({ id: 'EX-1' }),
      fixtureExecution({ id: 'EX-2' }),
    ]);
    const facade = createResultsFacade(api);
    const run = await facade.getRun('EX-2');
    expect(run?.id).toBe('EX-2');
  });

  it('getRun returns null for an unknown id', async () => {
    const api = fakeDashboardApi([fixtureExecution({ id: 'EX-1' })]);
    const facade = createResultsFacade(api);
    expect(await facade.getRun('nope')).toBeNull();
  });
});
