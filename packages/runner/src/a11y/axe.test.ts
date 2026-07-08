import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import { axeResultsToCtrf, evaluateA11yGate, type AxeRouteResult } from './axe';

const results: AxeRouteResult[] = [
  {
    route: 'https://preview.example.com/checkout',
    violations: [
      {
        id: 'color-contrast',
        impact: 'serious',
        description: 'Elements must meet minimum color contrast ratio thresholds',
        help: 'Elements must have sufficient color contrast',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        tags: ['wcag2aa', 'wcag143'],
        nodes: [
          { target: ['.checkout-total'], html: '<span class="checkout-total">$42</span>' },
          { target: ['.checkout-cta'], html: '<button class="checkout-cta">Pay</button>' },
        ],
      },
      {
        id: 'label',
        impact: 'critical',
        description: 'Form elements must have labels',
        help: 'Form elements must have labels',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/label',
        tags: ['wcag2a', 'wcag412'],
        nodes: [{ target: ['#promo-code'], html: '<input id="promo-code">' }],
      },
    ],
  },
  {
    route: 'https://preview.example.com/cart',
    violations: [
      {
        id: 'landmark-one-main',
        impact: 'moderate',
        description: 'Document should have one main landmark',
        help: 'Document should have one main landmark',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/landmark-one-main',
        tags: ['best-practice'],
        nodes: [{ target: ['body'], html: '<body>' }],
      },
      {
        id: 'region',
        impact: 'minor',
        description: 'All page content should be contained by landmarks',
        help: 'All page content should be contained by landmarks',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/region',
        tags: ['best-practice'],
        nodes: [{ target: ['.footer'], html: '<div class="footer">' }],
      },
    ],
  },
];

describe('axeResultsToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const report = axeResultsToCtrf(results);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool to axe-core', () => {
    expect(axeResultsToCtrf(results).results.tool.name).toBe('axe-core');
  });

  it('emits one test per (route, violation)', () => {
    expect(axeResultsToCtrf(results).results.tests).toHaveLength(4);
  });

  it('marks every violation as failed and carries impact/route/helpUrl/wcagTags/selectors', () => {
    const { tests } = axeResultsToCtrf(results).results;
    const colorContrast = tests.find(
      (t) => t.name === 'https://preview.example.com/checkout: color-contrast',
    );
    expect(colorContrast?.status).toBe('failed');
    expect(colorContrast?.extra).toMatchObject({
      impact: 'serious',
      route: 'https://preview.example.com/checkout',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
      wcagTags: ['wcag2aa', 'wcag143'],
      selectors: ['.checkout-total', '.checkout-cta'],
      nodeCount: 2,
    });
  });

  it('summarises the tests as failed (axe violations are never "passed")', () => {
    const { summary } = axeResultsToCtrf(results).results;
    expect(summary).toMatchObject({ tests: 4, passed: 0, failed: 4 });
  });

  it('returns an empty report for an empty result set', () => {
    const report = axeResultsToCtrf([]);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
    expect(report.results.tests).toHaveLength(0);
  });
});

describe('evaluateA11yGate', () => {
  const cfg = {
    blockOnImpact: ['critical', 'serious'] as const,
    warnOnImpact: ['moderate'] as const,
  };

  it('BLOCKs when a configured-blocking impact is present', () => {
    const report = axeResultsToCtrf(results);
    const gate = evaluateA11yGate(report, cfg);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toMatch(/blocking/);
  });

  it('WARNs when only a warn-level impact is present', () => {
    const moderateOnly = axeResultsToCtrf([
      {
        route: 'https://preview.example.com/cart',
        violations: [results[1]!.violations[0]!],
      },
    ]);
    const gate = evaluateA11yGate(moderateOnly, cfg);
    expect(gate.decision).toBe('WARN');
  });

  it('PASSes on an empty violation set', () => {
    const empty = axeResultsToCtrf([]);
    const gate = evaluateA11yGate(empty, cfg);
    expect(gate.decision).toBe('PASS');
  });

  it('PASSes when only impacts outside both block and warn lists are present', () => {
    const minorOnly = axeResultsToCtrf([
      {
        route: 'https://preview.example.com/cart',
        violations: [results[1]!.violations[1]!],
      },
    ]);
    const gate = evaluateA11yGate(minorOnly, cfg);
    expect(gate.decision).toBe('PASS');
  });
});
