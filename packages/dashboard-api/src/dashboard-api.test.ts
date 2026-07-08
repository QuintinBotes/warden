import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '@warden/test-management';
import { SqliteDashboardApi } from './dashboard-api.js';
import { seedStore } from './seed.js';

const ANCHOR = new Date('2026-07-07T12:00:00.000Z');

describe('SqliteDashboardApi', () => {
  let dir: string;
  let store: SqliteStore;
  let api: SqliteDashboardApi;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'warden-dashboard-api-'));
    store = new SqliteStore(join(dir, 'warden.db'));
    seedStore(store, ANCHOR);
    api = new SqliteDashboardApi(store);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('listRequirements', () => {
    it('returns all seeded requirements with no filter', async () => {
      const requirements = await api.listRequirements();
      expect(requirements).toHaveLength(5);
      expect(requirements.map((r) => r.id).sort()).toEqual([
        'REQ-AUTH-001',
        'REQ-AUTH-002',
        'REQ-CHECKOUT-001',
        'REQ-CHECKOUT-002',
        'REQ-SEARCH-001',
      ]);
    });

    it('filters by module (id prefix/tag substring)', async () => {
      const requirements = await api.listRequirements({ module: 'AUTH' });
      expect(requirements).toHaveLength(2);
      expect(requirements.every((r) => r.id.includes('AUTH'))).toBe(true);
    });

    it('filters by coverageStatus', async () => {
      // Force a known coverage status by saving directly.
      const all = await api.listRequirements();
      const target = all[0]!;
      store.saveRequirement({ ...target, coverageStatus: 'FAILED' });

      const failed = await api.listRequirements({ status: 'FAILED' });
      expect(failed.map((r) => r.id)).toContain(target.id);
      expect(failed.every((r) => r.coverageStatus === 'FAILED')).toBe(true);
    });

    it('combines module and status filters', async () => {
      store.saveRequirement({
        id: 'REQ-AUTH-001',
        title: 'Users can log in with valid credentials',
        type: 'story',
        linkedTestIds: ['TC-AUTH-001', 'TC-AUTH-002'],
        coverageStatus: 'PARTIAL',
      });

      const requirements = await api.listRequirements({ module: 'AUTH', status: 'PARTIAL' });
      expect(requirements.map((r) => r.id)).toEqual(['REQ-AUTH-001']);
    });
  });

  describe('coverageMatrix', () => {
    it('reflects the last result for each requirement x linked test', async () => {
      const cells = await api.coverageMatrix();

      // TC-AUTH-001 is a stable pass; the last (most recent) execution's result should show.
      const authOneCell = cells.find(
        (c) => c.requirementId === 'REQ-AUTH-001' && c.testCaseId === 'TC-AUTH-001',
      );
      expect(authOneCell?.lastResult).toBe('PASS');

      // TC-CHECKOUT-002 is a stable fail.
      const checkoutTwoCell = cells.find(
        (c) => c.requirementId === 'REQ-CHECKOUT-002' && c.testCaseId === 'TC-CHECKOUT-002',
      );
      expect(checkoutTwoCell?.lastResult).toBe('FAIL');
    });

    it('returns null for a linked test case with no executions', async () => {
      const cells = await api.coverageMatrix();
      const neverRun = cells.find(
        (c) => c.requirementId === 'REQ-SEARCH-001' && c.testCaseId === 'TC-SEARCH-002',
      );
      expect(neverRun).toBeDefined();
      expect(neverRun?.lastResult).toBeNull();
    });

    it('includes one cell per requirement x linked test id', async () => {
      const cells = await api.coverageMatrix();
      // 2 + 1 + 1 + 1 + 2 = 7 linked test ids across all requirements.
      expect(cells).toHaveLength(7);
    });
  });

  describe('executions', () => {
    it('returns all executions within a wide range', async () => {
      const executions = await api.executions({
        from: new Date(ANCHOR.getTime() - 30 * 24 * 60 * 60 * 1000),
        to: ANCHOR,
      });
      expect(executions).toHaveLength(5);
      expect(executions.map((e) => e.id).sort()).toEqual([
        'EXEC-1',
        'EXEC-2',
        'EXEC-3',
        'EXEC-4',
        'EXEC-5',
      ]);
    });

    it('filters executions to a narrower date range', async () => {
      // Only the last two executions (1 and 3 days ago) fall inside this window.
      const executions = await api.executions({
        from: new Date(ANCHOR.getTime() - 4 * 24 * 60 * 60 * 1000),
        to: ANCHOR,
      });
      expect(executions.map((e) => e.id).sort()).toEqual(['EXEC-4', 'EXEC-5']);
    });

    it('returns an empty array when the range excludes all executions', async () => {
      const executions = await api.executions({
        from: new Date('2099-01-01T00:00:00.000Z'),
        to: new Date('2099-01-02T00:00:00.000Z'),
      });
      expect(executions).toEqual([]);
    });

    it('returns fully-shaped TestExecution objects with results', async () => {
      const executions = await api.executions({
        from: new Date(ANCHOR.getTime() - 30 * 24 * 60 * 60 * 1000),
        to: ANCHOR,
      });
      const exec = executions.find((e) => e.id === 'EXEC-1')!;
      expect(exec.startedAt).toBeInstanceOf(Date);
      expect(exec.results.length).toBeGreaterThan(0);
      expect(exec.results.some((r) => r.testCaseId === 'TC-AUTH-001')).toBe(true);
    });
  });

  describe('flakeBoard', () => {
    it('flags the flaky test case as quarantined with a rate strictly between 0.2 and 0.8', async () => {
      const board = await api.flakeBoard();
      const authTwo = board.find((s) => s.testCaseId === 'TC-AUTH-002');
      expect(authTwo).toBeDefined();
      expect(authTwo?.flakeRate).toBeCloseTo(0.4);
      expect(authTwo?.quarantined).toBe(true);
    });

    it('does not quarantine a stable passing test case', async () => {
      const board = await api.flakeBoard();
      const authOne = board.find((s) => s.testCaseId === 'TC-AUTH-001');
      expect(authOne?.flakeRate).toBe(0);
      expect(authOne?.quarantined).toBe(false);
    });

    it('does not quarantine a stably failing test case (rate outside the 0.2-0.8 open interval? actually 1.0 is outside)', async () => {
      const board = await api.flakeBoard();
      const checkoutTwo = board.find((s) => s.testCaseId === 'TC-CHECKOUT-002');
      expect(checkoutTwo?.flakeRate).toBe(1);
      expect(checkoutTwo?.quarantined).toBe(false);
    });

    it('includes every distinct test case id referenced by requirements', async () => {
      const board = await api.flakeBoard();
      const ids = board.map((s) => s.testCaseId).sort();
      expect(ids).toEqual(
        [
          'TC-AUTH-001',
          'TC-AUTH-002',
          'TC-AUTH-003',
          'TC-CHECKOUT-001',
          'TC-CHECKOUT-002',
          'TC-SEARCH-001',
          'TC-SEARCH-002',
        ].sort(),
      );
    });
  });

  describe('trends', () => {
    const wideRange = {
      from: new Date(ANCHOR.getTime() - 30 * 24 * 60 * 60 * 1000),
      to: ANCHOR,
    };

    it('returns one point per execution in range for passRate', async () => {
      const points = await api.trends('passRate', wideRange);
      expect(points).toHaveLength(5);
      for (const point of points) {
        expect(point.at).toBeInstanceOf(Date);
        expect(point.value).toBeGreaterThanOrEqual(0);
        expect(point.value).toBeLessThanOrEqual(1);
      }
    });

    it('computes flakeRate, mttr, coverage, and suiteDuration as non-negative numbers', async () => {
      for (const metric of ['flakeRate', 'mttr', 'coverage', 'suiteDuration'] as const) {
        const points = await api.trends(metric, wideRange);
        expect(points).toHaveLength(5);
        for (const point of points) {
          expect(typeof point.value).toBe('number');
          expect(point.value).toBeGreaterThanOrEqual(0);
          expect(Number.isNaN(point.value)).toBe(false);
        }
      }
    });

    it('respects date-range filtering', async () => {
      const points = await api.trends('passRate', {
        from: new Date(ANCHOR.getTime() - 4 * 24 * 60 * 60 * 1000),
        to: ANCHOR,
      });
      expect(points).toHaveLength(2);
    });

    it('mttr reflects the average duration of failing results for each execution', async () => {
      const points = await api.trends('mttr', wideRange);
      // Every seeded execution has TC-CHECKOUT-002 failing at 1800ms; some also have
      // TC-AUTH-002 failing at 950ms, which pulls the average down but never to 0.
      for (const point of points) {
        expect(point.value).toBeGreaterThan(0);
        expect(point.value).toBeLessThanOrEqual(1800);
      }
    });
  });

  describe('flake intelligence', () => {
    it('flakeBoardDetailed adds impact, classification, and mttr to the flaky test case', async () => {
      store.saveFlakeClassification({
        testCaseId: 'TC-AUTH-002',
        rootCause: 'timing',
        confidence: 0.7,
        explanation: 'timeout waiting for redirect',
        classifiedAt: ANCHOR,
      });
      store.recordQuarantineEvent({
        testCaseId: 'TC-AUTH-002',
        event: 'quarantined',
        at: new Date(ANCHOR.getTime() - 8 * 24 * 60 * 60 * 1000),
      });
      store.recordQuarantineEvent({
        testCaseId: 'TC-AUTH-002',
        event: 'cleared',
        at: new Date(ANCHOR.getTime() - 6 * 24 * 60 * 60 * 1000),
      });

      const board = await api.flakeBoardDetailed();
      const authTwo = board.find((e) => e.testCaseId === 'TC-AUTH-002');

      expect(authTwo).toBeDefined();
      expect(authTwo?.quarantined).toBe(true);
      expect(authTwo?.flakeRate).toBeCloseTo(0.4);
      expect(authTwo?.rootCause).toBe('timing');
      expect(authTwo?.mttrHours).toBe(48);
      expect(authTwo?.impact.testCaseId).toBe('TC-AUTH-002');

      // A stable, unclassified test case has an impact but no rootCause/mttr.
      const authOne = board.find((e) => e.testCaseId === 'TC-AUTH-001');
      expect(authOne?.rootCause).toBeUndefined();
      expect(authOne?.mttrHours).toBeUndefined();
      expect(authOne?.impact).toBeDefined();
    });

    it('topOffenders ranks by CI minutes lost, most costly first', async () => {
      // Give TC-AUTH-001 a costly retry history so it becomes the top offender.
      store.saveExecution({
        id: 'EXEC-EXTRA',
        testPlanId: 'PLAN-NIGHTLY',
        triggerType: 'pr',
        triggerRef: 'refs/pull/99',
        environment: 'staging',
        startedAt: ANCHOR,
        completedAt: new Date(ANCHOR.getTime() + 60000),
        results: [
          {
            testCaseId: 'TC-AUTH-001',
            status: 'FLAKY',
            duration: 120000,
            retries: 2,
            flakeFlag: true,
            artifacts: [],
          },
        ],
      });

      const top = await api.topOffenders(1);
      expect(top).toHaveLength(1);
      expect(top[0]?.testCaseId).toBe('TC-AUTH-001');
      // 2 retries * 120000ms / 60000 = 4 CI minutes lost
      expect(top[0]?.impact.ciMinutesLost).toBe(4);
    });

    it('flakeTrend buckets by day with flake rate and quarantine-event counts', async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      // Episode spanning two seeded execution days.
      store.recordQuarantineEvent({
        testCaseId: 'TC-AUTH-002',
        event: 'quarantined',
        at: new Date(ANCHOR.getTime() - 5 * dayMs), // 2026-07-02
      });
      store.recordQuarantineEvent({
        testCaseId: 'TC-AUTH-002',
        event: 'cleared',
        at: new Date(ANCHOR.getTime() - 1 * dayMs), // 2026-07-06
      });

      const points = await api.flakeTrend({
        from: new Date(ANCHOR.getTime() - 30 * dayMs),
        to: ANCHOR,
      });
      // Five seeded executions on five distinct days.
      expect(points).toHaveLength(5);

      const byDay = Object.fromEntries(points.map((p) => [p.at.toISOString().slice(0, 10), p]));

      // 2026-07-02: TC-AUTH-002 flaked (1 of 6 results) and was quarantined that day.
      expect(byDay['2026-07-02']?.flakeRate).toBeCloseTo(1 / 6);
      expect(byDay['2026-07-02']?.newlyFlagged).toBe(1);
      expect(byDay['2026-07-02']?.deflaked).toBe(0);

      // 2026-07-06: flaked again and the quarantine cleared that day.
      expect(byDay['2026-07-06']?.deflaked).toBe(1);

      // A clean day has a zero flake rate and no events.
      expect(byDay['2026-06-28']?.flakeRate).toBe(0);
      expect(byDay['2026-06-28']?.newlyFlagged).toBe(0);
    });
  });
});
