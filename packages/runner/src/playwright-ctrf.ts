import { CTRFReportSchema, type CTRFReport, type CTRFTest } from '@warden/core';

/**
 * Pure converter from a Playwright JSON report (`--reporter=json`) to a {@link CTRFReport}.
 *
 * It flattens Playwright's nested suite tree, maps result statuses (`passed`/`failed`/`skipped`/
 * `timedOut`) onto CTRF statuses, and lifts captured media (video/screenshot/trace) file paths
 * into each test's `extra` so the dashboard can replay them. Output is validated with
 * {@link CTRFReportSchema} before it is returned.
 */

export interface PlaywrightJsonToCtrfOptions {
  /** Overrides the tool version recorded in the report (defaults to the Playwright config version). */
  toolVersion?: string;
}

interface PwAttachment {
  name?: string;
  path?: string;
  contentType?: string;
}

interface PwResult {
  status?: string;
  duration?: number;
  error?: { message?: string; stack?: string };
  attachments?: PwAttachment[];
}

interface PwTest {
  status?: string;
  results?: PwResult[];
}

interface PwSpec {
  title?: string;
  file?: string;
  tags?: string[];
  tests?: PwTest[];
}

interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

interface PwReport {
  config?: { version?: string };
  stats?: { startTime?: string; duration?: number };
  suites?: PwSuite[];
}

const ANSI = /\x1b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI, '');
}

function mapStatus(status: string | undefined): CTRFTest['status'] {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
    case 'timedOut':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      return 'other';
  }
}

function collectMedia(result: PwResult | undefined): Record<string, unknown> {
  const media: Record<string, unknown> = {};
  for (const att of result?.attachments ?? []) {
    if (!att?.path || !att.name) continue;
    if (att.name === 'video' || att.name === 'screenshot' || att.name === 'trace') {
      media[att.name] = att.path;
    }
  }
  return media;
}

function specToTest(spec: PwSpec, fallbackFile: string | undefined): CTRFTest {
  // The final test/result is the authoritative attempt (retries append later results).
  const test = spec.tests?.[spec.tests.length - 1];
  const result = test?.results?.[test.results.length - 1];
  const media = collectMedia(result);

  const ctrfTest: CTRFTest = {
    name: spec.title ?? 'unnamed test',
    status: mapStatus(result?.status),
    duration: result?.duration ?? 0,
    filePath: spec.file ?? fallbackFile,
  };

  const message = result?.error?.message;
  if (message) ctrfTest.message = stripAnsi(message);

  const stack = result?.error?.stack;
  if (stack) ctrfTest.trace = stripAnsi(stack);

  if (spec.tags && spec.tags.length > 0) ctrfTest.tags = spec.tags;
  if (Object.keys(media).length > 0) ctrfTest.extra = media;

  return ctrfTest;
}

function flatten(suites: PwSuite[] | undefined, out: CTRFTest[]): void {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      out.push(specToTest(spec, suite.file));
    }
    flatten(suite.suites, out);
  }
}

export function playwrightJsonToCtrf(
  json: unknown,
  opts: PlaywrightJsonToCtrfOptions = {},
): CTRFReport {
  const report = (json ?? {}) as PwReport;

  const tests: CTRFTest[] = [];
  flatten(report.suites, tests);

  const summary = {
    tests: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    pending: tests.filter((t) => t.status === 'pending').length,
    other: tests.filter((t) => t.status === 'other').length,
    start: 0,
    stop: 0,
  };

  const parsedStart = report.stats?.startTime ? Date.parse(report.stats.startTime) : NaN;
  const start = Number.isNaN(parsedStart) ? 0 : parsedStart;
  summary.start = start;
  summary.stop = start + (report.stats?.duration ?? 0);

  const version = opts.toolVersion ?? report.config?.version;

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'playwright', ...(version ? { version } : {}) },
      summary,
      tests,
    },
  });
}
