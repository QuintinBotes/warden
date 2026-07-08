import { describe, expect, it } from 'vitest';
import { CTRFReportSchema, type CTRFReport, type GridCapability } from '@warden/core';
import { mergeCtrf } from '@warden/reporter';
import { mergeLaneReports } from './merge-lanes';
import { gridTag } from './stamp-lane';

function laneReport(name: string, status: 'passed' | 'failed'): CTRFReport {
  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'playwright' },
      summary: {
        tests: 1,
        passed: status === 'passed' ? 1 : 0,
        failed: status === 'failed' ? 1 : 0,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 1,
      },
      tests: [{ name, status, duration: 1 }],
    },
  });
}

const webkit: GridCapability = {
  id: 'local:webkit',
  browser: 'webkit',
  platform: 'linux',
  real: false,
};
const iosReal: GridCapability = {
  id: 'browserstack:safari:iphone-15',
  browser: 'safari',
  platform: 'ios',
  device: 'iPhone 15',
  real: true,
};

describe('mergeLaneReports', () => {
  const reports = [laneReport('a', 'passed'), laneReport('b', 'failed')];
  const caps = [webkit, iosReal];

  it('merges the lane counts exactly like mergeCtrf (no double counting)', () => {
    const merged = mergeLaneReports(reports, caps);
    expect(merged.results.summary).toEqual(mergeCtrf(reports).results.summary);
    expect(merged.results.summary.tests).toBe(2);
    expect(merged.results.summary.passed).toBe(1);
    expect(merged.results.summary.failed).toBe(1);
  });

  it('preserves per-lane provenance on each test after the merge', () => {
    const merged = mergeLaneReports(reports, caps);
    const a = merged.results.tests.find((t) => t.name === 'a')!;
    const b = merged.results.tests.find((t) => t.name === 'b')!;
    expect(a.tags).toContain(gridTag(webkit));
    expect(b.tags).toContain(gridTag(iosReal));
    expect((a.extra?.grid as { laneId: string }).laneId).toBe('local:webkit');
    expect((b.extra?.grid as { real: boolean }).real).toBe(true);
  });

  it('stamps optional per-lane replay urls', () => {
    const merged = mergeLaneReports(reports, caps, [undefined, 'https://replay/x']);
    const b = merged.results.tests.find((t) => t.name === 'b')!;
    expect((b.extra?.grid as { replayUrl?: string }).replayUrl).toBe('https://replay/x');
  });

  it('throws when reports and capabilities do not correspond 1:1', () => {
    expect(() => mergeLaneReports(reports, [webkit])).toThrow(/correspond/);
  });
});
