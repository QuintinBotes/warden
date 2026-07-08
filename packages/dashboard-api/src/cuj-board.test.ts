import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '@warden/test-management';
import { CujSchema, type Cuj, type TestExecution } from '@warden/core';
import { SqliteCujBoardApi } from './cuj-board.js';

const cuj = (overrides: Partial<Cuj> = {}): Cuj =>
  CujSchema.parse({
    id: 'CUJ-checkout',
    name: 'Guest checkout',
    owningTeam: 'payments',
    tier: 'tier1',
    steps: [
      { order: 1, name: 'Add item to cart', module: '@apps/cart', testIds: ['TC-cart'] },
      { order: 2, name: 'Pay', module: '@apps/checkout', testIds: ['TC-pay'] },
    ],
    ...overrides,
  });

function execution(results: TestExecution['results'], startedAt: string): TestExecution {
  return {
    id: `EX-${startedAt}`,
    testPlanId: 'TP-1',
    triggerType: 'pr',
    triggerRef: '1',
    environment: 'preview',
    startedAt: new Date(startedAt),
    results,
  };
}

const r = (testCaseId: string, status: TestExecution['results'][number]['status']) => ({
  testCaseId,
  status,
  duration: 10,
  retries: 0,
  flakeFlag: false,
  artifacts: [],
});

describe('SqliteCujBoardApi', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'warden-cuj-board-'));
    store = new SqliteStore(join(dir, 'warden.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('projects per-CUJ and per-step health from the stored executions', async () => {
    store.saveExecution(
      execution([r('TC-cart', 'PASS'), r('TC-pay', 'FAIL')], '2026-07-09T12:00:00.000Z'),
    );
    const api = new SqliteCujBoardApi(store, [cuj()]);

    const board = await api.cujBoard();

    expect(board).toHaveLength(1);
    expect(board[0]!.cujId).toBe('CUJ-checkout');
    expect(board[0]!.owningTeam).toBe('payments');
    expect(board[0]!.status).toBe('BROKEN');
    const byStep = Object.fromEntries(board[0]!.steps.map((s) => [s.name, s.status]));
    expect(byStep['Add item to cart']).toBe('HEALTHY');
    expect(byStep['Pay']).toBe('BROKEN');
  });

  it('uses the most-recent execution result per test case', async () => {
    store.saveExecution(
      execution([r('TC-cart', 'FAIL'), r('TC-pay', 'FAIL')], '2026-07-08T12:00:00.000Z'),
    );
    store.saveExecution(
      execution([r('TC-cart', 'PASS'), r('TC-pay', 'PASS')], '2026-07-09T12:00:00.000Z'),
    );
    const api = new SqliteCujBoardApi(store, [cuj()]);

    const board = await api.cujBoard();
    expect(board[0]!.status).toBe('HEALTHY');
  });

  it('is NOT_TESTED when the store has no results for the linked tests', async () => {
    const api = new SqliteCujBoardApi(store, [cuj()]);
    const board = await api.cujBoard();
    expect(board[0]!.status).toBe('NOT_TESTED');
  });
});
