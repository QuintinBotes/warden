/**
 * The machine-readable gate report — the contract between `warden report aggregate --json`
 * and any CI integration that reads its verdict (the GitHub Action is the first).
 *
 * It lives here, in the shared contract surface, because it previously did not live anywhere:
 * the action declared the shape it expected and the CLI printed a human sentence, and nothing
 * in either build could see the disagreement. One definition, imported by both sides, turns
 * that class of drift into a type error.
 */

/** Roll-up counts for the report header. */
export interface GateReportSummary {
  total: number;
  passed: number;
  failed: number;
}

/** A failed test, carried in the shape a CI host needs to annotate a file and line. */
export interface GateReportFailure {
  /** Repository-relative path of the test file. Omitted when the runner did not report one. */
  path: string;
  /** 1-based line, when known. A reader that needs a line falls back to 1. */
  line?: number;
  message: string;
  title?: string;
  /**
   * How a CI host should render this failure. The CLI always says `failure`, but the field is
   * optional and carries the full annotation vocabulary because a host may derive its own level
   * (by test priority, say) from a report that omits it.
   */
  annotation_level?: 'notice' | 'warning' | 'failure';
}

/**
 * What `warden report aggregate --json` writes to stdout: the gate decision first, and the
 * evidence a CI host renders around it. Every field but `gate` is optional — a reader must
 * degrade to its own rendering rather than assume the CLI filled anything in.
 */
export interface GateReport {
  gate: { decision: 'PASS' | 'WARN' | 'BLOCK'; reason: string };
  /** Path of an aggregated CTRF file on disk, when one was written. */
  reportPath?: string;
  summary?: GateReportSummary;
  failures?: GateReportFailure[];
  /** Pre-rendered Markdown; when absent the reader renders its own report. */
  markdown?: string;
}
