import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { createCujEngine } from './index.js';
import { fixtureCuj, fixtureResult, memCujSource, memExecutionHistory } from './testing-fakes.js';

const cfg = defineConfig({ cuj: { enabled: true } });
const NOW = new Date('2026-07-09T00:00:00.000Z');

describe('createCujEngine', () => {
  it('wires the full pipeline from injected IO', async () => {
    const source = memCujSource({
      'checkout.yaml': JSON.stringify({
        id: 'CUJ-checkout',
        name: 'Guest checkout',
        owningTeam: 'payments',
        tags: ['@apps/checkout'],
        steps: [{ order: 1, name: 'Pay', module: '@apps/checkout', testIds: ['TC-pay'] }],
      }),
    });
    const history = memExecutionHistory({
      main: [fixtureResult('TC-pay', 'PASS')],
    });
    const engine = createCujEngine({ source, history, now: () => NOW });

    const { cujs } = await engine.loadCujs('.warden/cuj/');
    expect(cujs).toHaveLength(1);

    const touched = engine.resolveTouched(
      fixtureChangeSurface({ testTags: ['@apps/checkout'], changedModules: [] }),
      cujs,
    );
    expect(touched).toHaveLength(1);

    const before = await engine.resolveBaseline(touched, 'main');
    const after = [engine.computeHealth(cujs[0]!, [fixtureResult('TC-pay', 'FAIL')])];

    const decision = engine.evaluateGate({ touched, before, after, cfg });
    expect(decision.decision).toBe('BLOCK'); // HEALTHY baseline → BROKEN after

    const board = engine.projectBoard(cujs, () => [fixtureResult('TC-pay', 'PASS')]);
    expect(board[0]!.status).toBe('HEALTHY');
  });

  it('throws a clear error if resolveBaseline is used without a history port', async () => {
    const engine = createCujEngine({ source: memCujSource({}) });
    const touched = [{ cuj: fixtureCuj(), matchedTags: [], reason: '' }];
    await expect(engine.resolveBaseline(touched, 'main')).rejects.toThrow(/history/);
  });
});
