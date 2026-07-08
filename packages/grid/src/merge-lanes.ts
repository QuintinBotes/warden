import { WardenError, type CTRFReport, type GridCapability } from '@warden/core';
import { mergeCtrf } from '@warden/reporter';
import { stampLane } from './stamp-lane';

/**
 * Fold per-lane CTRF reports into one merged report, preserving lane provenance. `reports[i]` ran
 * on `capabilities[i]`; each report is {@link stampLane stamped} with its lane, then the whole set
 * is merged with the reporter's `mergeCtrf` — so the merged counts equal `mergeCtrf`'s output (no
 * double counting) while every test still carries its `@grid:<laneId>` tag + `extra.grid` block.
 *
 * Optional `replayUrls[i]` (from each lane's `GridSessionInfo`) is stamped onto that lane's tests.
 */
export function mergeLaneReports(
  reports: CTRFReport[],
  capabilities: GridCapability[],
  replayUrls?: Array<string | undefined>,
): CTRFReport {
  if (reports.length !== capabilities.length) {
    throw new WardenError(
      `mergeLaneReports: ${reports.length} reports but ${capabilities.length} capabilities; they must correspond 1:1`,
      'E_GRID_MERGE_MISMATCH',
    );
  }
  const stamped = reports.map((report, i) => stampLane(report, capabilities[i]!, replayUrls?.[i]));
  return mergeCtrf(stamped);
}
