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
});
