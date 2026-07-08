import { describe, expect, it } from 'vitest';
import type { VisualComparison } from '@warden/core';
import { severityFor, visualToFindings } from './to-findings.js';
import { fixtureCheck } from './testing-fakes.js';

function comparison(overrides: Partial<VisualComparison>): VisualComparison {
  return {
    check: fixtureCheck(),
    status: 'VISUAL_DIFF',
    changedRatio: 0.5,
    candidatePath: 'artifacts/candidate.png',
    ...overrides,
  };
}

describe('visualToFindings', () => {
  it('emits findings only for VISUAL_DIFF comparisons', () => {
    const findings = visualToFindings([
      comparison({ status: 'MATCH', changedRatio: 0 }),
      comparison({ status: 'NEW_BASELINE', changedRatio: 0 }),
      comparison({ status: 'VISUAL_DIFF', changedRatio: 0.3 }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.module).toBe('apps/checkout');
    expect(findings[0]!.candidatePath).toBe('artifacts/candidate.png');
  });

  it('derives severity from changedRatio', () => {
    expect(severityFor(0.2)).toBe('HIGH');
    expect(severityFor(0.05)).toBe('MEDIUM');
    expect(severityFor(0.005)).toBe('LOW');
  });

  it('carries the judge rationale and triptych paths through', () => {
    const [finding] = visualToFindings([
      comparison({
        status: 'VISUAL_DIFF',
        changedRatio: 0.15,
        judgment: { classification: 'meaningful', confidence: 0.9, rationale: 'CTA clipped' },
        baselinePath: 'b.png',
        diffPath: 'd.png',
      }),
    ]);

    expect(finding!.severity).toBe('HIGH');
    expect(finding!.rationale).toBe('CTA clipped');
    expect(finding!.baselinePath).toBe('b.png');
    expect(finding!.diffPath).toBe('d.png');
  });
});
