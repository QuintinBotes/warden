import { describe, expect, it } from 'vitest';
import { fixtureExecution } from '@warden/core/testing';
import { renderPrReport } from './pr-report.js';

describe('renderPrReport', () => {
  it('contains the gate decision line', () => {
    const execution = fixtureExecution();

    const markdown = renderPrReport(execution, { decision: 'BLOCK', reason: 'critical bug found' });

    expect(markdown).toContain('BLOCK');
    expect(markdown).toContain('critical bug found');
  });

  it('renders bugs found from exploratory findings', () => {
    const execution = fixtureExecution();

    const markdown = renderPrReport(
      execution,
      { decision: 'WARN', reason: 'high severity issues' },
      {
        findings: [
          {
            title: 'Checkout button does nothing on Safari',
            severity: 'HIGH',
            steps: ['Open checkout', 'Click pay'],
            expected: 'Payment is processed',
            actual: 'Nothing happens',
          },
        ],
      },
    );

    expect(markdown).toContain('Checkout button does nothing on Safari');
    expect(markdown).toContain('HIGH');
    expect(markdown).toContain('Payment is processed');
  });

  it('renders "no bugs found" when there are no findings', () => {
    const execution = fixtureExecution();

    const markdown = renderPrReport(execution, { decision: 'PASS', reason: 'all good' });

    expect(markdown.toLowerCase()).toContain('no bugs found');
  });

  it('renders a coverage table from execution results', () => {
    const execution = fixtureExecution();

    const markdown = renderPrReport(execution, { decision: 'PASS', reason: 'all good' });

    expect(markdown).toContain('TC-042');
    expect(markdown).toContain('PASS');
  });

  it('shows the human-readable test name in the coverage table when present', () => {
    const execution = fixtureExecution({
      results: [
        {
          testCaseId: 'TC-042',
          name: 'checkout › apply discount code',
          status: 'PASS',
          duration: 10,
          retries: 0,
          flakeFlag: false,
        },
      ],
    });

    const markdown = renderPrReport(execution, { decision: 'PASS', reason: 'all good' });

    expect(markdown).toContain('checkout › apply discount code');
  });

  it('renders a requirements traceability table', () => {
    const execution = fixtureExecution();

    const markdown = renderPrReport(
      execution,
      { decision: 'PASS', reason: 'all good' },
      {
        requirements: [
          {
            id: 'REQ-1',
            title: 'Checkout works',
            type: 'story',
            linkedTestIds: ['TC-042'],
            coverageStatus: 'PASSED',
          },
        ],
      },
    );

    expect(markdown).toContain('REQ-1');
    expect(markdown).toContain('Checkout works');
    expect(markdown).toContain('PASSED');
  });

  it('renders the risk score when provided', () => {
    const execution = fixtureExecution();

    const markdown = renderPrReport(
      execution,
      { decision: 'PASS', reason: 'all good' },
      { riskScore: 42 },
    );

    expect(markdown).toContain('42');
  });

  it('omits the Visual Regression section when no visualFindings are passed', () => {
    const markdown = renderPrReport(fixtureExecution(), { decision: 'PASS', reason: 'all good' });

    expect(markdown).not.toContain('Visual Regression');
  });

  it('renders the Visual Regression section with triptych links', () => {
    const markdown = renderPrReport(
      fixtureExecution(),
      { decision: 'WARN', reason: 'visual diffs' },
      {
        visualFindings: [
          {
            module: 'apps/checkout',
            viewport: 'desktop',
            theme: 'light',
            severity: 'HIGH',
            changedRatio: 0.25,
            rationale: 'CTA clipped below the fold',
            baselinePath: 'artifacts/checkout-baseline.png',
            candidatePath: 'artifacts/checkout-candidate.png',
            diffPath: 'artifacts/checkout-diff.png',
          },
        ],
      },
    );

    expect(markdown).toContain('## Visual Regression');
    expect(markdown).toContain('apps/checkout');
    expect(markdown).toContain('25.00%');
    expect(markdown).toContain('[baseline](artifacts/checkout-baseline.png)');
    expect(markdown).toContain('[candidate](artifacts/checkout-candidate.png)');
    expect(markdown).toContain('[diff](artifacts/checkout-diff.png)');
    expect(markdown).toContain('CTA clipped below the fold');
  });

  it('renders an empty-state line when visualFindings is an empty array', () => {
    const markdown = renderPrReport(
      fixtureExecution(),
      { decision: 'PASS', reason: 'all good' },
      { visualFindings: [] },
    );

    expect(markdown).toContain('## Visual Regression');
    expect(markdown.toLowerCase()).toContain('no visual regressions');
  });

  it('escapes pipe characters in visual finding text', () => {
    const markdown = renderPrReport(
      fixtureExecution(),
      { decision: 'WARN', reason: 'visual diffs' },
      {
        visualFindings: [
          {
            module: 'apps/a|b',
            viewport: 'desktop',
            theme: 'dark',
            severity: 'MEDIUM',
            changedRatio: 0.05,
            candidatePath: 'artifacts/c.png',
          },
        ],
      },
    );

    expect(markdown).toContain('apps/a\\|b');
  });
});
