import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import type { DiffFile } from '@warden/core';
import { scoreRisk } from './index';

const noHighRisk = defineConfig({ scope: { highRiskPatterns: [] } });

function file(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status };
}

describe('scoreRisk', () => {
  it('returns score 0 and no reasons for an empty diff', () => {
    const result = scoreRisk([], noHighRisk);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('scores a single payment-flow file via the built-in rule', () => {
    const result = scoreRisk([file('apps/checkout/pay.ts')], noHighRisk);
    // payment rule (checkout) = 5, plus clamped file-count contribution of 1.
    expect(result.score).toBe(6);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]?.pattern).toBe('checkout');
    expect(result.reasons[0]?.score).toBe(5);
  });

  it('accumulates multiple built-in rules that match one file', () => {
    const result = scoreRisk([file('src/db/auth-migration.ts')], noHighRisk);
    // auth (3) + database/migration (4) + file-count clamp (1) = 8.
    expect(result.score).toBe(8);
    const patterns = result.reasons.map((r) => r.pattern).sort();
    expect(patterns).toEqual(['auth', 'migration']);
  });

  it('adds +3 for each configured high-risk path pattern that matches', () => {
    const cfg = defineConfig({ scope: { highRiskPatterns: ['admin'] } });
    const result = scoreRisk([file('apps/admin/users.ts')], cfg);
    // admin is not a built-in rule; only the high-risk pattern (3) + file clamp (1) = 4.
    expect(result.score).toBe(4);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]?.pattern).toBe('admin');
    expect(result.reasons[0]?.score).toBe(3);
  });

  it('clamps the total score to a maximum of 10', () => {
    const files = Array.from({ length: 5 }, (_, i) => file(`apps/checkout/pay-${i}.ts`));
    const result = scoreRisk(files, noHighRisk);
    // 5 files * payment(5) = 25, clamps to 10.
    expect(result.score).toBe(10);
  });

  it('matches case-insensitively', () => {
    const result = scoreRisk([file('apps/Login/Session.ts')], noHighRisk);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.pattern === 'login')).toBe(true);
  });
});
