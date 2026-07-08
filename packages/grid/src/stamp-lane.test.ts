import { describe, expect, it } from 'vitest';
import { CTRFReportSchema, type CTRFReport, type GridCapability } from '@warden/core';
import { gridTag, stampLane, type LaneProvenance } from './stamp-lane';

function report(): CTRFReport {
  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'playwright', version: '1.52.0' },
      summary: {
        tests: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 5,
      },
      tests: [
        { name: 'checkout passes', status: 'passed', duration: 3, tags: ['@smoke'] },
        { name: 'checkout fails', status: 'failed', duration: 2 },
      ],
    },
  });
}

const capability: GridCapability = {
  id: 'browserstack:safari-17:iphone-15',
  browser: 'safari',
  browserVersion: '17',
  platform: 'ios',
  platformVersion: '17.0',
  device: 'iPhone 15',
  real: true,
};

describe('stampLane', () => {
  it('adds a @grid:<laneId> tag to every test, preserving existing tags', () => {
    const stamped = stampLane(report(), capability);
    const tag = gridTag(capability);
    expect(tag).toBe('@grid:browserstack:safari-17:iphone-15');
    for (const test of stamped.results.tests) {
      expect(test.tags).toContain(tag);
    }
    expect(stamped.results.tests[0]!.tags).toContain('@smoke');
  });

  it('writes an extra.grid provenance block onto every test', () => {
    const stamped = stampLane(report(), capability, 'https://replay.example/s/1');
    const expected: LaneProvenance = {
      laneId: 'browserstack:safari-17:iphone-15',
      browser: 'safari',
      platform: 'ios',
      browserVersion: '17',
      platformVersion: '17.0',
      device: 'iPhone 15',
      real: true,
      replayUrl: 'https://replay.example/s/1',
    };
    for (const test of stamped.results.tests) {
      expect(test.extra?.grid).toEqual(expected);
    }
  });

  it('omits the replay url when none is provided', () => {
    const stamped = stampLane(report(), capability);
    expect((stamped.results.tests[0]!.extra?.grid as LaneProvenance).replayUrl).toBeUndefined();
  });

  it('preserves summary and tool, and produces a schema-valid report', () => {
    const stamped = stampLane(report(), capability);
    expect(stamped.results.summary).toEqual(report().results.summary);
    expect(stamped.results.tool).toEqual({ name: 'playwright', version: '1.52.0' });
    expect(CTRFReportSchema.safeParse(stamped).success).toBe(true);
  });

  it('does not mutate the input report', () => {
    const input = report();
    stampLane(input, capability);
    expect(input.results.tests[1]!.tags).toBeUndefined();
    expect(input.results.tests[0]!.extra).toBeUndefined();
  });

  it('is idempotent on the lane tag (no duplicate @grid tag)', () => {
    const once = stampLane(report(), capability);
    const twice = stampLane(once, capability);
    const tag = gridTag(capability);
    expect(twice.results.tests[0]!.tags!.filter((t) => t === tag)).toHaveLength(1);
  });
});
