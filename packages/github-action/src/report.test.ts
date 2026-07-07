import { describe, expect, it } from 'vitest';
import { buildAnnotations, checkTitle, gateToConclusion, renderPrReport } from './report.js';
import type { AggregateFailure } from './parse.js';

describe('gateToConclusion', () => {
  it('maps gate verdicts to check-run conclusions', () => {
    expect(gateToConclusion('BLOCK')).toBe('failure');
    expect(gateToConclusion('WARN')).toBe('neutral');
    expect(gateToConclusion('PASS')).toBe('success');
  });
});

describe('buildAnnotations', () => {
  it('maps failures to GitHub check annotations, P1 -> failure else warning', () => {
    const failures: AggregateFailure[] = [
      { path: 'a.ts', line: 42, message: 'boom', title: 'pay', priority: 'P1' },
      { path: 'b.ts', message: 'warn', priority: 'P2' },
    ];
    const anns = buildAnnotations(failures);
    expect(anns[0]).toEqual({
      path: 'a.ts',
      start_line: 42,
      end_line: 42,
      annotation_level: 'failure',
      message: 'boom',
      title: 'pay',
    });
    expect(anns[1]?.annotation_level).toBe('warning');
    expect(anns[1]?.start_line).toBe(1);
  });

  it('drops failures with no file path', () => {
    expect(buildAnnotations([{ path: '', message: 'x' }])).toEqual([]);
  });
});

describe('renderPrReport', () => {
  it('renders the blueprint PR report sections', () => {
    const md = renderPrReport({
      prNumber: 123,
      riskScore: 7,
      riskThreshold: 4,
      gate: { decision: 'BLOCK', reason: '1 CRITICAL failure(s)' },
      summary: { total: 47, passed: 44, failed: 3 },
      testTags: '@apps/checkout',
      findings: [
        {
          title: 'Payment fails for Visa 4242',
          severity: 'CRITICAL',
          steps: ['Add to cart', 'Checkout'],
          expected: 'Payment confirmed',
          actual: 'Error processing payment',
        },
      ],
    });
    expect(md).toContain('AI QA Report');
    expect(md).toContain('PR #123');
    expect(md).toContain('7/10');
    expect(md).toContain('44/47');
    expect(md).toContain('Bugs Found (1)');
    expect(md).toContain('[CRITICAL] Payment fails for Visa 4242');
    expect(md).toContain('BLOCK');
    expect(md).toContain('1 CRITICAL failure(s)');
  });

  it('renders a clean report when there are no findings', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 1,
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
    });
    expect(md).toContain('No bugs found');
    expect(md).toContain('PASS');
  });
});

describe('checkTitle', () => {
  it('summarizes gate and counts', () => {
    expect(checkTitle('BLOCK', { total: 47, passed: 44, failed: 3 })).toContain('3 failing');
    expect(checkTitle('PASS')).toContain('PASS');
  });
});
