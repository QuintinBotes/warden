import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  FlakeClassification,
  Requirement,
  TestExecution,
  TestPlan,
  TestResult,
} from '@warden/core';
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

  it('listExecutions returns executions chronologically, filtered by range and limit', () => {
    const days = ['2024-01-01', '2024-01-05', '2024-01-10'];
    days.forEach((d, i) =>
      store.saveExecution(
        makeExecution({ id: `EXEC-${i}`, startedAt: new Date(`${d}T00:00:00.000Z`) }),
      ),
    );

    // all, oldest first
    expect(store.listExecutions().map((e) => e.id)).toEqual(['EXEC-0', 'EXEC-1', 'EXEC-2']);

    // date range excludes out-of-window executions
    const inRange = store.listExecutions({
      from: new Date('2024-01-03T00:00:00.000Z'),
      to: new Date('2024-01-07T00:00:00.000Z'),
    });
    expect(inRange.map((e) => e.id)).toEqual(['EXEC-1']);

    // limit caps the count; results are full, schema-valid executions
    const limited = store.listExecutions({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.results[0]?.status).toBe('PASS');
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

  it('round-trips a flake classification via save/getFlakeClassification', () => {
    const classification: FlakeClassification = {
      testCaseId: 'TC-001',
      rootCause: 'selector',
      confidence: 0.82,
      explanation: 'Strict mode violation on a renamed locator.',
      classifiedAt: new Date('2026-07-07T12:00:00.000Z'),
    };

    store.saveFlakeClassification(classification);
    const loaded = store.getFlakeClassification('TC-001');

    expect(loaded).toEqual(classification);
    expect(loaded?.classifiedAt).toBeInstanceOf(Date);
    expect(store.getFlakeClassification('missing')).toBeUndefined();
  });

  it('upserts the classification for the same test case', () => {
    const at = new Date('2026-07-07T12:00:00.000Z');
    store.saveFlakeClassification({
      testCaseId: 'TC-001',
      rootCause: 'timing',
      confidence: 0.3,
      explanation: 'first',
      classifiedAt: at,
    });
    store.saveFlakeClassification({
      testCaseId: 'TC-001',
      rootCause: 'network',
      confidence: 0.9,
      explanation: 'second',
      classifiedAt: at,
    });
    expect(store.getFlakeClassification('TC-001')?.rootCause).toBe('network');
  });

  it('appends and lists quarantine events chronologically, filtered by test case', () => {
    store.recordQuarantineEvent({
      testCaseId: 'TC-001',
      event: 'quarantined',
      at: new Date('2026-07-01T00:00:00.000Z'),
    });
    store.recordQuarantineEvent({
      testCaseId: 'TC-002',
      event: 'quarantined',
      at: new Date('2026-07-02T00:00:00.000Z'),
    });
    store.recordQuarantineEvent({
      testCaseId: 'TC-001',
      event: 'cleared',
      at: new Date('2026-07-03T00:00:00.000Z'),
    });

    const all = store.listQuarantineEvents();
    expect(all).toHaveLength(3);
    expect(all[0]?.at.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(all[0]?.at).toBeInstanceOf(Date);

    const forOne = store.listQuarantineEvents('TC-001');
    expect(forOne.map((e) => e.event)).toEqual(['quarantined', 'cleared']);
  });
});
