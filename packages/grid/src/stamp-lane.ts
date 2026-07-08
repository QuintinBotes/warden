import {
  CTRFReportSchema,
  type CTRFReport,
  type CTRFTest,
  type GridCapability,
} from '@warden/core';

/**
 * The `extra.grid` provenance block written onto every {@link CTRFTest} in a stamped report.
 * Because the reporter's `mergeCtrf` drops the top-level CTRF `environment`, lane provenance rides
 * on per-test `tags` + `extra.grid` so it survives the merge and reaches the four GitHub surfaces.
 */
export interface LaneProvenance {
  laneId: string;
  browser: GridCapability['browser'];
  platform: GridCapability['platform'];
  browserVersion?: string;
  platformVersion?: string;
  device?: string;
  real: boolean;
  replayUrl?: string;
}

/** The tag prefix that carries a lane id on each CTRF test, e.g. `@grid:browserstack:safari-17`. */
export const GRID_TAG_PREFIX = '@grid:';

/** Build the `@grid:<laneId>` provenance tag for a capability. */
export function gridTag(capability: GridCapability): string {
  return `${GRID_TAG_PREFIX}${capability.id}`;
}

/**
 * Stamp every test in a CTRF report with the lane it ran on: a `@grid:<laneId>` tag plus an
 * `extra.grid` provenance block (browser / platform / device / real / replay). Pure — returns a new
 * report and never mutates the input. Existing tags and `extra` keys are preserved.
 */
export function stampLane(
  report: CTRFReport,
  capability: GridCapability,
  replayUrl?: string,
): CTRFReport {
  const tag = gridTag(capability);
  const grid: LaneProvenance = {
    laneId: capability.id,
    browser: capability.browser,
    platform: capability.platform,
    real: capability.real,
  };
  if (capability.browserVersion !== undefined) grid.browserVersion = capability.browserVersion;
  if (capability.platformVersion !== undefined) grid.platformVersion = capability.platformVersion;
  if (capability.device !== undefined) grid.device = capability.device;
  if (replayUrl !== undefined) grid.replayUrl = replayUrl;

  const tests: CTRFTest[] = report.results.tests.map((test) => {
    const existingTags = test.tags ?? [];
    const tags = existingTags.includes(tag) ? existingTags : [...existingTags, tag];
    return {
      ...test,
      tags,
      extra: { ...(test.extra ?? {}), grid },
    };
  });

  return CTRFReportSchema.parse({
    results: {
      tool: report.results.tool,
      summary: report.results.summary,
      tests,
      ...(report.results.environment !== undefined
        ? { environment: report.results.environment }
        : {}),
    },
  });
}
