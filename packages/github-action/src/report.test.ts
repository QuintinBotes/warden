import { describe, expect, it } from 'vitest';
import {
  buildAnnotations,
  checkTitle,
  gateToConclusion,
  renderIncompleteTiers,
  renderPrReport,
  renderUnknownChangeSurface,
} from './report.js';
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

  it('renders a clean report when the agent ran and found nothing', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 1,
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      agent: { ran: true },
    });
    expect(md).toContain('No bugs found');
    expect(md).toContain('PASS');
  });

  it('never claims a clean agent run when the agent tier failed', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 8,
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      agent: { ran: false, reason: "the tier failed: unknown option '--provider'" },
    });
    expect(md).not.toContain('No bugs found');
    expect(md).not.toContain('Bugs Found (0)');
    expect(md).toContain('did not report on this PR');
    expect(md).toContain("unknown option '--provider'");
  });

  it('says the agent was skipped, rather than clean, when risk was below the threshold', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 1,
      riskThreshold: 4,
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
      agent: { ran: false, reason: 'risk 1 is below the threshold of 4, so the tier was skipped' },
    });
    expect(md).not.toContain('No bugs found');
    expect(md).toContain('risk 1 is below the threshold of 4');
  });

  it('makes no bug claim at all when the agent outcome was not recorded', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 1,
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
    });
    expect(md).not.toContain('No bugs found');
    expect(md).toContain('not recorded');
  });

  it('says the numbers came from built-in defaults when the repository has no warden.config', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 3,
      gate: { decision: 'PASS', reason: 'All tests passed' },
      summary: { total: 1, passed: 1, failed: 0 },
      configured: false,
    });
    // A green check on an unconfigured repository must carry its own provenance.
    expect(md).toContain('warden.config');
    expect(md).toContain('built-in defaults');
  });

  it('claims nothing about provenance when the repository is configured', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 3,
      gate: { decision: 'PASS', reason: 'All tests passed' },
      configured: true,
    });
    expect(md).not.toContain('warden.config');
  });

  it('claims nothing about provenance when it was never established', () => {
    // `configured` omitted: an older CLI that does not emit the line. Unknown is not "unconfigured".
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 3,
      gate: { decision: 'PASS', reason: 'All tests passed' },
    });
    expect(md).not.toContain('warden.config');
  });

  it('renders a clean report when there are no findings', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 1,
      gate: { decision: 'PASS', reason: 'All exit criteria met' },
    });
    expect(md).not.toContain('No bugs found');
    expect(md).toContain('not recorded');
  });

  it('still lists findings the agent reported', () => {
    const md = renderPrReport({
      prNumber: 9,
      riskScore: 8,
      gate: { decision: 'BLOCK', reason: '1 finding' },
      agent: { ran: true },
      findings: [
        {
          title: 'Cart empties on refresh',
          severity: 'HIGH',
          steps: [],
          expected: 'Cart persists',
          actual: 'Cart is empty',
        },
      ],
    });
    expect(md).toContain('Bugs Found (1)');
    expect(md).toContain('Cart empties on refresh');
  });
});

describe('checkTitle', () => {
  it('summarizes gate and counts', () => {
    expect(checkTitle('BLOCK', { total: 47, passed: 44, failed: 3 })).toContain('3 failing');
    expect(checkTitle('PASS')).toContain('PASS');
  });

  it('says which tier did not complete, in place of a count drawn from a partial suite', () => {
    const title = checkTitle('BLOCK', { total: 47, passed: 44, failed: 3 }, [
      { name: 'regression', message: 'browser crashed' },
    ]);
    expect(title).toContain('regression');
    expect(title).toContain('did not complete');
    expect(title).not.toContain('3 failing');
  });
});

describe('renderIncompleteTiers', () => {
  it('is empty when every tier completed', () => {
    expect(renderIncompleteTiers([])).toBe('');
  });

  it('names each lost tier and its error', () => {
    const md = renderIncompleteTiers([
      { name: 'regression', message: 'browser crashed (SIGKILL)' },
      { name: 'agent', message: 'anthropic: 529 overloaded' },
    ]);
    expect(md).toContain('2 tiers did not complete');
    expect(md).toContain('regression');
    expect(md).toContain('browser crashed (SIGKILL)');
    expect(md).toContain('529 overloaded');
  });

  it('escapes a pipe in an error so the table cannot be broken by the message', () => {
    const md = renderIncompleteTiers([{ name: 'smoke', message: 'sh -c a | b failed' }]);
    expect(md).toContain('a \\| b');
  });

  it('folds a multi-line error onto the row rather than out of the table', () => {
    const md = renderIncompleteTiers([
      { name: 'smoke', message: 'npx: install failed\n  at Module._load\n  at run' },
    ]);
    expect(md.split('\n').every((line) => line.startsWith('>'))).toBe(true);
    expect(md).toContain('npx: install failed at Module._load at run');
  });
});

describe('renderPrReport with an unmeasured change surface', () => {
  it('renders an absent risk score as unknown, never as 0/10 LOW', () => {
    const md = renderPrReport({
      prNumber: 42,
      riskScore: null,
      gate: { decision: 'PASS', reason: 'All tests passed' },
      summary: { total: 4, passed: 4, failed: 0 },
    });
    expect(md).toContain('**Risk Score:** unknown');
    expect(md).not.toContain('0/10');
    expect(md).not.toContain('LOW');
  });
});

describe('renderUnknownChangeSurface', () => {
  it('is empty when the change surface was analyzed', () => {
    expect(renderUnknownChangeSurface(null)).toBe('');
  });

  it('says risk is unknown rather than low, names the cause, and gives the fix', () => {
    const md = renderUnknownChangeSurface(
      'Failed to run `git diff --name-status b h`: fatal: bad object b',
    );
    expect(md).toContain('unknown');
    expect(md).toContain('fatal: bad object b');
    // The reader needs the remedy, because the default checkout is the cause.
    expect(md).toContain('fetch-depth: 0');
    // A multi-line CLI error must not break out of the blockquote.
    expect(md.split('\n').every((l) => l.startsWith('>'))).toBe(true);
  });

  it('keeps a multi-line error on one blockquote line', () => {
    const md = renderUnknownChangeSurface('boom\nstack frame one\nstack frame two');
    expect(md).toContain('boom stack frame one stack frame two');
  });
});
