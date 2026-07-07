import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CTRFReportSchema, WardenError, type CTRFReport, type MergeCtrf } from '@warden/core';

const EMPTY_SUMMARY = {
  tests: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  pending: 0,
  other: 0,
  start: 0,
  stop: 0,
};

/** Merges several CTRF reports into one — the `MergeCtrf` contract from `@warden/core`. */
export const mergeCtrf: MergeCtrf = (reports: CTRFReport[]): CTRFReport => {
  if (reports.length === 0) {
    return CTRFReportSchema.parse({
      results: { tool: { name: 'warden' }, summary: EMPTY_SUMMARY, tests: [] },
    });
  }

  const tests = reports.flatMap((report) => report.results.tests);
  const summary = reports.reduce(
    (acc, report) => {
      const s = report.results.summary;
      return {
        tests: acc.tests + s.tests,
        passed: acc.passed + s.passed,
        failed: acc.failed + s.failed,
        skipped: acc.skipped + s.skipped,
        pending: acc.pending + s.pending,
        other: acc.other + s.other,
        start: Math.min(acc.start, s.start),
        stop: Math.max(acc.stop, s.stop),
      };
    },
    {
      tests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      other: 0,
      start: Infinity,
      stop: -Infinity,
    },
  );

  return CTRFReportSchema.parse({
    results: {
      tool: reports[0]!.results.tool,
      summary,
      tests,
    },
  });
};

/** Reads every `*.json` CTRF file in `reportsDir` and merges them into one report. */
export async function aggregate(reportsDir: string): Promise<CTRFReport> {
  let entries: string[];
  try {
    entries = await fs.readdir(reportsDir);
  } catch (err) {
    throw new WardenError(
      `Failed to read CTRF reports directory "${reportsDir}": ${(err as Error).message}`,
      'REPORTER_AGGREGATE_READDIR_FAILED',
    );
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort();

  const reports: CTRFReport[] = [];
  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(reportsDir, file), 'utf-8');
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      throw new WardenError(
        `Failed to parse CTRF report "${file}": ${(err as Error).message}`,
        'REPORTER_AGGREGATE_INVALID_JSON',
      );
    }
    reports.push(CTRFReportSchema.parse(parsedJson));
  }

  return mergeCtrf(reports);
}
