import { promises as fs, type Dirent } from 'node:fs';
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

/**
 * Collects every `*.json` file at or below `rootDir`, as paths relative to it and sorted so
 * the merge order is deterministic.
 *
 * The walk is recursive because CTRF never arrives flat in the pipeline this exists for. Each
 * tier runs `warden run --artifacts-dir warden-artifacts/<tier>`, which is already one level
 * down, and `actions/download-artifact` unpacks each uploaded artifact into a directory of its
 * own under the download path — so on the gate runner every report is nested. A single-level
 * `readdir` found none of them and merged nothing, which reads as "no tests ran": a gate that
 * cannot see a failing test cannot block on one.
 */
async function collectReportFiles(rootDir: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (dir: string, relativeDir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new WardenError(
        `Failed to read CTRF reports directory "${dir}": ${(err as Error).message}`,
        'REPORTER_AGGREGATE_READDIR_FAILED',
      );
    }

    for (const entry of entries) {
      const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      // `isDirectory()` is false for a symlink even when it points at a directory, so a
      // symlinked directory is skipped rather than followed: an artifact tree containing a
      // cycle must not hang the merge gate.
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        found.push(relative);
      }
    }
  };

  await walk(rootDir, '');
  return found.sort();
}

/**
 * A CTRF report is recognised by its envelope: a top-level `results` object. The directory
 * handed to `aggregate` is the *artifacts* directory, which by design also holds JSON that was
 * never a test report — `warden agent --output warden-artifacts/exploratory-report.json` writes
 * an `AgentOutput` there, and `warden run` writes `fixture-catalog.json` — so "ends in .json"
 * is not the same question as "is a CTRF report".
 */
function looksLikeCtrf(doc: unknown): boolean {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    typeof (doc as { results?: unknown }).results === 'object' &&
    (doc as { results?: unknown }).results !== null
  );
}

/**
 * Reads every CTRF report at or below `reportsDir` — subdirectories included — and merges them
 * into one.
 *
 * JSON files that are not CTRF reports are skipped rather than fatal: they are the artifacts
 * directory's other tenants, and the gate must still reach a decision when one is present. A
 * file that *is* CTRF-shaped but fails the schema is fatal — skipping it would drop real test
 * results out of the merge and shrink the run the gate scores.
 */
export async function aggregate(reportsDir: string): Promise<CTRFReport> {
  const jsonFiles = await collectReportFiles(reportsDir);

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

    if (!looksLikeCtrf(parsedJson)) continue;

    const parsed = CTRFReportSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
        .join('; ');
      throw new WardenError(
        `CTRF report "${file}" is not a valid CTRF report: ${issues}`,
        'REPORTER_AGGREGATE_INVALID_CTRF',
      );
    }
    reports.push(parsed.data);
  }

  return mergeCtrf(reports);
}
