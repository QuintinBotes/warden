import { describe, it, expect } from 'vitest';
import type { Cuj, TestResult } from '@warden/core';
import { projectCujBoard } from './board.js';
import { fixtureCuj, fixtureResult } from './testing-fakes.js';

const NOW = new Date('2026-07-09T00:00:00.000Z');

describe('projectCujBoard', () => {
  it('rolls every CUJ up to a health report with per-step status', () => {
    const checkout = fixtureCuj({ id: 'CUJ-checkout', name: 'Guest checkout' });
    const signin = fixtureCuj({
      id: 'CUJ-signin',
      name: 'Sign in',
      owningTeam: 'identity',
      tier: 'tier2',
      steps: [{ order: 1, name: 'Enter credentials', module: '@apps/auth', testIds: ['TC-login'] }],
    });

    const resultsByCuj: Record<string, TestResult[]> = {
      'CUJ-checkout': [fixtureResult('TC-cart', 'PASS'), fixtureResult('TC-pay', 'FAIL')],
      'CUJ-signin': [fixtureResult('TC-login', 'PASS')],
    };

    const board = projectCujBoard([checkout, signin], (cuj: Cuj) => resultsByCuj[cuj.id] ?? [], {
      now: NOW,
    });

    expect(board.map((r) => r.cujId)).toEqual(['CUJ-checkout', 'CUJ-signin']);

    const checkoutReport = board[0]!;
    expect(checkoutReport.status).toBe('BROKEN');
    expect(checkoutReport.owningTeam).toBe('payments');
    expect(checkoutReport.steps.find((s) => s.name === 'Pay')!.status).toBe('BROKEN');

    const signinReport = board[1]!;
    expect(signinReport.status).toBe('HEALTHY');
    expect(signinReport.tier).toBe('tier2');
    expect(signinReport.computedAt).toBe(NOW.toISOString());
  });

  it('folds per-CUJ signals into the board projection', () => {
    const cuj = fixtureCuj({ id: 'CUJ-x' });
    const board = projectCujBoard(
      [cuj],
      () => [fixtureResult('TC-cart', 'PASS'), fixtureResult('TC-pay', 'PASS')],
      { now: NOW, signalsByCuj: { 'CUJ-x': [{ kind: 'perf', value: 999, passed: false }] } },
    );
    expect(board[0]!.status).toBe('DEGRADED');
  });
});
