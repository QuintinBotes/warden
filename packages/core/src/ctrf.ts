import { z } from 'zod';

/**
 * CTRF — the Common Test Report Format. A universal JSON schema for test results so
 * Warden speaks one report language regardless of whether tests ran under Playwright,
 * Vitest, k6, or ZAP. See https://ctrf.io.
 */

export const CTRFTestSchema = z.object({
  name: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'pending', 'other']),
  duration: z.number(),
  message: z.string().optional(),
  trace: z.string().optional(),
  filePath: z.string().optional(),
  /**
   * The suite the test belongs to. Vitest and Jest reporters emit this where Playwright
   * emits `filePath`, and it is the only grouping some runners report at all — dropped
   * here, a whole run arrives at the dashboard with nothing to group or filter by.
   */
  suite: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type CTRFTest = z.infer<typeof CTRFTestSchema>;

export const CTRFSummarySchema = z.object({
  tests: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  pending: z.number(),
  other: z.number(),
  start: z.number(),
  stop: z.number(),
});
export type CTRFSummary = z.infer<typeof CTRFSummarySchema>;

export const CTRFReportSchema = z.object({
  results: z.object({
    tool: z.object({ name: z.string(), version: z.string().optional() }),
    summary: CTRFSummarySchema,
    tests: z.array(CTRFTestSchema),
    environment: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type CTRFReport = z.infer<typeof CTRFReportSchema>;

/**
 * Merges several CTRF reports into one (e.g. smoke + regression + api tiers).
 * Declared here as the platform contract; implemented by the reporter (WS-14).
 */
export type MergeCtrf = (reports: CTRFReport[]) => CTRFReport;
