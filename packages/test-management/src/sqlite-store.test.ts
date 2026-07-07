import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Requirement, TestExecution, TestPlan, TestResult } from '@warden/core';
import { SqliteStore } from './sqlite-store.js';

function makeResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    testCaseId: 'TC-001',
    status: 'PASS',
    duration: 100,
    retries: 0,
    flakeFlag: false,
    artifacts: [],
    ...overrides,
  };
}

function makeExecution(overrides: Partial<TestExecution> = {}): TestExecution {
  return {
    id: 'EXEC-001',
    testPlanId: 'PLAN-001',
    triggerType: 'pr',
    triggerRef: 'refs/pull/1',
    environment: 'staging',
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    results: [makeResult()],
    ...overrides,
  };
}

describe('SqliteStore', () => {
  let dir: string;
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'warden-test-management-'));
    dbPath = join(dir, 'warden.db');
    store = new SqliteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips an execution via saveExecution/getExecution', () => {
    const exec = makeExecution();
    store.saveExecution(exec);

    const loaded = store.getExecution(exec.id);

    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe(exec.id);
    expect(loaded?.testPlanId).toBe(exec.testPlanId);
    expect(loaded?.triggerType).toBe(exec.triggerType);
    expect(loaded?.startedAt).toBeInstanceOf(Date);
    expect(loaded?.startedAt.toISOString()).toBe(exec.startedAt.toISOString());
    expect(loaded?.completedAt).toBeUndefined();
    expect(loaded?.results).toEqual(exec.results);
  });

  it('round-trips completedAt when present', () => {
    const exec = makeExecution({ completedAt: new Date('2024-01-01T01:00:00.000Z') });
    store.saveExecution(exec);

    const loaded = store.getExecution(exec.id);

    expect(loaded?.completedAt).toBeInstanceOf(Date);
    expect(loaded?.completedAt?.toISOString()).toBe('2024-01-01T01:00:00.000Z');
  });

  it('returns undefined for a missing execution', () => {
    expect(store.getExecution('does-not-exist')).toBeUndefined();
  });

  it('getRecentExecutions returns the test case-s results across the most recent n executions, newest first', () => {
    store.saveExecution(
      makeExecution({
        id: 'EXEC-1',
        startedAt: new Date('2024-01-01T00:00:00.000Z'),
        results: [makeResult({ testCaseId: 'TC-001', status: 'PASS', duration: 1 })],
      }),
    );
    store.saveExecution(
      makeExecution({
        id: 'EXEC-2',
        startedAt: new Date('2024-01-02T00:00:00.000Z'),
        results: [makeResult({ testCaseId: 'TC-001', status: 'FAIL', duration: 2 })],
      }),
    );
    store.saveExecution(
      makeExecution({
        id: 'EXEC-3',
        startedAt: new Date('2024-01-03T00:00:00.000Z'),
        results: [
          makeResult({ testCaseId: 'TC-001', status: 'PASS', duration: 3 }),
          makeResult({ testCaseId: 'TC-002', status: 'FAIL', duration: 4 }),
        ],
      }),
    );

    const recent = store.getRecentExecutions('TC-001', 2);

    expect(recent).toHaveLength(2);
    expect(recent[0]?.duration).toBe(3);
    expect(recent[1]?.duration).toBe(2);
  });

  it('round-trips a requirement via saveRequirement/getRequirements', () => {
    const req: Requirement = {
      id: 'REQ-001',
      title: 'Users can log in',
      type: 'story',
      linkedTestIds: ['TC-001'],
      coverageStatus: 'NOT_TESTED',
    };

    store.saveRequirement(req);
    store.saveRequirement({ ...req, id: 'REQ-002', title: 'Second' });

    const all = store.getRequirements();

    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === 'REQ-001')).toEqual(req);
  });

  it('upserts a requirement with the same id', () => {
    const req: Requirement = {
      id: 'REQ-001',
      title: 'Original',
      type: 'story',
      linkedTestIds: [],
      coverageStatus: 'NOT_TESTED',
    };
    store.saveRequirement(req);
    store.saveRequirement({ ...req, title: 'Updated' });

    const all = store.getRequirements();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Updated');
  });

  it('round-trips a test plan via saveTestPlan/getTestPlan', () => {
    const plan: TestPlan = {
      id: 'PLAN-001',
      name: 'Release plan',
      version: '1.0.0',
      testSetIds: ['TS-1'],
      environments: ['staging'],
      entryCriteria: [],
      exitCriteria: [],
      schedule: 'on_pr',
      status: 'ACTIVE',
    };

    store.saveTestPlan(plan);

    expect(store.getTestPlan(plan.id)).toEqual(plan);
    expect(store.getTestPlan('missing')).toBeUndefined();
  });
});
