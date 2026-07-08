import { describe, expect, it } from 'vitest';
import { defineConfig, type VisualComparison } from '@warden/core';
import { visualToCtrf, VISUAL_TOOL_NAME } from './to-ctrf.js';
import { fixtureCheck } from './testing-fakes.js';

function comparison(overrides: Partial<VisualComparison>): VisualComparison {
  return {
    check: fixtureCheck(),
    status: 'MATCH',
    changedRatio: 0,
    baselinePath: 'baselines/checkout.png',
    candidatePath: 'artifacts/checkout-candidate.png',
    diffPath: 'artifacts/checkout-diff.png',
    ...overrides,
  };
}

describe('visualToCtrf', () => {
  it('emits a warden-visual report', () => {
    const ctrf = visualToCtrf([comparison({})], defineConfig({ visual: { enabled: true } }));
    expect(ctrf.results.tool.name).toBe(VISUAL_TOOL_NAME);
  });

  it('maps MATCH to passed with media paths in extra', () => {
    const ctrf = visualToCtrf(
      [comparison({ status: 'MATCH' })],
      defineConfig({ visual: { enabled: true } }),
    );
    const [test] = ctrf.results.tests;
    expect(test!.status).toBe('passed');
    expect(test!.extra!.candidatePath).toBe('artifacts/checkout-candidate.png');
    expect(test!.extra!.baselinePath).toBe('baselines/checkout.png');
    expect(test!.extra!.diffPath).toBe('artifacts/checkout-diff.png');
    expect(test!.extra!.visualStatus).toBe('MATCH');
  });

  it('maps VISUAL_DIFF to failed under gate: block', () => {
    const ctrf = visualToCtrf(
      [comparison({ status: 'VISUAL_DIFF', changedRatio: 0.2 })],
      defineConfig({ visual: { enabled: true, gate: 'block' } }),
    );
    expect(ctrf.results.tests[0]!.status).toBe('failed');
    expect(ctrf.results.summary.failed).toBe(1);
  });

  it('maps VISUAL_DIFF to a warn-tagged other under gate: warn', () => {
    const ctrf = visualToCtrf(
      [comparison({ status: 'VISUAL_DIFF', changedRatio: 0.2 })],
      defineConfig({ visual: { enabled: true, gate: 'warn' } }),
    );
    const [test] = ctrf.results.tests;
    expect(test!.status).toBe('other');
    expect(test!.tags).toContain('warn');
    expect(ctrf.results.summary.failed).toBe(0);
    expect(ctrf.results.summary.other).toBe(1);
  });

  it('maps NEW_BASELINE to failed only under onNewBaseline: block', () => {
    const neutral = visualToCtrf(
      [comparison({ status: 'NEW_BASELINE' })],
      defineConfig({ visual: { enabled: true, onNewBaseline: 'neutral' } }),
    );
    expect(neutral.results.tests[0]!.status).toBe('passed');

    const blocking = visualToCtrf(
      [comparison({ status: 'NEW_BASELINE' })],
      defineConfig({ visual: { enabled: true, onNewBaseline: 'block' } }),
    );
    expect(blocking.results.tests[0]!.status).toBe('failed');
  });

  it('surfaces the judge verdict on the CTRF test', () => {
    const ctrf = visualToCtrf(
      [
        comparison({
          status: 'VISUAL_DIFF',
          changedRatio: 0.2,
          judgment: {
            classification: 'meaningful',
            confidence: 0.8,
            rationale: 'nav overlaps hero',
          },
        }),
      ],
      defineConfig({ visual: { enabled: true, gate: 'block' } }),
    );
    const [test] = ctrf.results.tests;
    expect(test!.message).toBe('nav overlaps hero');
    expect(test!.extra!.classification).toBe('meaningful');
    expect(test!.extra!.confidence).toBe(0.8);
  });
});
