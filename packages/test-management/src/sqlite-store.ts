import Database from 'better-sqlite3';
import { z } from 'zod';
import {
  FlakeRootCause,
  RequirementSchema,
  TestExecutionSchema,
  TestPlanSchema,
  TestResultSchema,
  WardenError,
  type FlakeClassification,
  type Requirement,
  type TestExecution,
  type TestPlan,
  type TestResult,
} from '@warden/core';

/** Storage row shape for a flake classification (dates serialised as ISO strings). */
const FlakeClassificationRowSchema = z.object({
  testCaseId: z.string(),
  rootCause: FlakeRootCause,
  confidence: z.number(),
  explanation: z.string(),
  classifiedAt: z.string(),
});

/** Storage row shape for a quarantine-state transition. */
const QuarantineEventRowSchema = z.object({
  testCaseId: z.string(),
  event: z.enum(['quarantined', 'cleared']),
  at: z.string(),
});

/** A single quarantine-state transition, as returned by {@link SqliteStore.listQuarantineEvents}. */
export interface QuarantineEvent {
  testCaseId: string;
  event: 'quarantined' | 'cleared';
  at: Date;
}

interface ExecutionRow {
  id: string;
  testPlanId: string;
  triggerType: string;
  triggerRef: string;
  environment: string;
  startedAt: string;
  completedAt: string | null;
}

interface ResultRow {
  data: string;
}

/**
 * SQLite-backed execution history store. Executions, their per-test results,
 * requirements, and test plans are each persisted in their own table; nested
 * structures (results, tags, criteria, ...) are stored as JSON columns and
 * re-validated against the core zod schemas on every read.
 */
export class SqliteStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        testPlanId TEXT NOT NULL,
        triggerType TEXT NOT NULL,
        triggerRef TEXT NOT NULL,
        environment TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS results (
        executionId TEXT NOT NULL,
        testCaseId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        data TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_results_execution ON results (executionId);
      CREATE INDEX IF NOT EXISTS idx_results_testcase ON results (testCaseId);

      CREATE TABLE IF NOT EXISTS requirements (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS test_plans (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flake_classifications (
        testCaseId TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flake_quarantine_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        testCaseId TEXT NOT NULL,
        event TEXT NOT NULL,
        at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_quarantine_events_testcase
        ON flake_quarantine_events (testCaseId);
    `);
  }

  saveExecution(e: TestExecution): void {
    const validated = TestExecutionSchema.parse(e);

    const upsertExecution = this.db.prepare(`
      INSERT INTO executions (id, testPlanId, triggerType, triggerRef, environment, startedAt, completedAt)
      VALUES (@id, @testPlanId, @triggerType, @triggerRef, @environment, @startedAt, @completedAt)
      ON CONFLICT(id) DO UPDATE SET
        testPlanId = excluded.testPlanId,
        triggerType = excluded.triggerType,
        triggerRef = excluded.triggerRef,
        environment = excluded.environment,
        startedAt = excluded.startedAt,
        completedAt = excluded.completedAt
    `);
    const deleteResults = this.db.prepare(`DELETE FROM results WHERE executionId = ?`);
    const insertResult = this.db.prepare(`
      INSERT INTO results (executionId, testCaseId, seq, data)
      VALUES (@executionId, @testCaseId, @seq, @data)
    `);

    const run = this.db.transaction(() => {
      upsertExecution.run({
        id: validated.id,
        testPlanId: validated.testPlanId,
        triggerType: validated.triggerType,
        triggerRef: validated.triggerRef,
        environment: validated.environment,
        startedAt: validated.startedAt.toISOString(),
        completedAt: validated.completedAt ? validated.completedAt.toISOString() : null,
      });
      deleteResults.run(validated.id);
      validated.results.forEach((result, seq) => {
        insertResult.run({
          executionId: validated.id,
          testCaseId: result.testCaseId,
          seq,
          data: JSON.stringify(result),
        });
      });
    });
    run();
  }

  getExecution(id: string): TestExecution | undefined {
    const row = this.db.prepare(`SELECT * FROM executions WHERE id = ?`).get(id) as
      ExecutionRow | undefined;
    if (!row) return undefined;

    const resultRows = this.db
      .prepare(`SELECT data FROM results WHERE executionId = ? ORDER BY seq ASC`)
      .all(id) as ResultRow[];
    const results = resultRows.map((r) => TestResultSchema.parse(JSON.parse(r.data)));

    return TestExecutionSchema.parse({
      id: row.id,
      testPlanId: row.testPlanId,
      triggerType: row.triggerType,
      triggerRef: row.triggerRef,
      environment: row.environment,
      startedAt: new Date(row.startedAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : undefined,
      results,
    });
  }

  getRecentExecutions(testCaseId: string, n: number): TestResult[] {
    const executionIds = (
      this.db
        .prepare(`SELECT id FROM executions ORDER BY startedAt DESC, id DESC LIMIT ?`)
        .all(n) as { id: string }[]
    ).map((row) => row.id);

    const results: TestResult[] = [];
    const stmt = this.db.prepare(
      `SELECT data FROM results WHERE executionId = ? AND testCaseId = ? ORDER BY seq ASC`,
    );
    for (const executionId of executionIds) {
      const rows = stmt.all(executionId, testCaseId) as ResultRow[];
      for (const row of rows) {
        results.push(TestResultSchema.parse(JSON.parse(row.data)));
      }
    }
    return results;
  }

  /**
   * List executions in chronological order (oldest first), optionally filtered by a
   * `startedAt` date range and capped by `limit`. Each execution is reconstructed via
   * {@link getExecution}, so every read stays schema-validated.
   */
  listExecutions(opts: { from?: Date; to?: Date; limit?: number } = {}): TestExecution[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (opts.from) {
      clauses.push('startedAt >= ?');
      params.push(opts.from.toISOString());
    }
    if (opts.to) {
      clauses.push('startedAt <= ?');
      params.push(opts.to.toISOString());
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = opts.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(opts.limit))}` : '';
    const ids = (
      this.db
        .prepare(`SELECT id FROM executions ${where} ORDER BY startedAt ASC, id ASC${limit}`)
        .all(...params) as { id: string }[]
    ).map((row) => row.id);

    const executions: TestExecution[] = [];
    for (const id of ids) {
      const execution = this.getExecution(id);
      if (execution) executions.push(execution);
    }
    return executions;
  }

  saveRequirement(r: Requirement): void {
    const validated = RequirementSchema.parse(r);
    this.db
      .prepare(
        `INSERT INTO requirements (id, data) VALUES (@id, @data)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run({ id: validated.id, data: JSON.stringify(validated) });
  }

  getRequirements(): Requirement[] {
    const rows = this.db.prepare(`SELECT data FROM requirements`).all() as ResultRow[];
    return rows.map((row) => RequirementSchema.parse(JSON.parse(row.data)));
  }

  saveTestPlan(p: TestPlan): void {
    const validated = TestPlanSchema.parse(p);
    this.db
      .prepare(
        `INSERT INTO test_plans (id, data) VALUES (@id, @data)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run({ id: validated.id, data: JSON.stringify(validated) });
  }

  getTestPlan(id: string): TestPlan | undefined {
    const row = this.db.prepare(`SELECT data FROM test_plans WHERE id = ?`).get(id) as
      ResultRow | undefined;
    if (!row) return undefined;
    return TestPlanSchema.parse(JSON.parse(row.data));
  }

  /** Upserts the latest root-cause classification for a test case. */
  saveFlakeClassification(c: FlakeClassification): void {
    const row = FlakeClassificationRowSchema.parse({
      testCaseId: c.testCaseId,
      rootCause: c.rootCause,
      confidence: c.confidence,
      explanation: c.explanation,
      classifiedAt: c.classifiedAt.toISOString(),
    });
    this.db
      .prepare(
        `INSERT INTO flake_classifications (testCaseId, data) VALUES (@testCaseId, @data)
         ON CONFLICT(testCaseId) DO UPDATE SET data = excluded.data`,
      )
      .run({ testCaseId: row.testCaseId, data: JSON.stringify(row) });
  }

  /** The latest classification for `testCaseId`, or `undefined` if none has been recorded. */
  getFlakeClassification(testCaseId: string): FlakeClassification | undefined {
    const row = this.db
      .prepare(`SELECT data FROM flake_classifications WHERE testCaseId = ?`)
      .get(testCaseId) as ResultRow | undefined;
    if (!row) return undefined;
    const parsed = FlakeClassificationRowSchema.parse(JSON.parse(row.data));
    return {
      testCaseId: parsed.testCaseId,
      rootCause: parsed.rootCause,
      confidence: parsed.confidence,
      explanation: parsed.explanation,
      classifiedAt: new Date(parsed.classifiedAt),
    };
  }

  /** Appends one quarantine-state transition (append-only history; never updated in place). */
  recordQuarantineEvent(e: QuarantineEvent): void {
    const row = QuarantineEventRowSchema.parse({
      testCaseId: e.testCaseId,
      event: e.event,
      at: e.at.toISOString(),
    });
    this.db
      .prepare(
        `INSERT INTO flake_quarantine_events (testCaseId, event, at)
         VALUES (@testCaseId, @event, @at)`,
      )
      .run(row);
  }

  /** Quarantine events in chronological order, optionally filtered to one `testCaseId`. */
  listQuarantineEvents(testCaseId?: string): QuarantineEvent[] {
    const rows = (
      testCaseId !== undefined
        ? this.db
            .prepare(
              `SELECT testCaseId, event, at FROM flake_quarantine_events
               WHERE testCaseId = ? ORDER BY at ASC, id ASC`,
            )
            .all(testCaseId)
        : this.db
            .prepare(
              `SELECT testCaseId, event, at FROM flake_quarantine_events
               ORDER BY at ASC, id ASC`,
            )
            .all()
    ) as unknown[];
    return rows.map((raw) => {
      const parsed = QuarantineEventRowSchema.parse(raw);
      return { testCaseId: parsed.testCaseId, event: parsed.event, at: new Date(parsed.at) };
    });
  }

  close(): void {
    this.db.close();
  }
}

/** Thrown for storage-layer failures that aren't schema-validation errors from zod. */
export class TestManagementError extends WardenError {
  constructor(message: string) {
    super(message, 'E_TEST_MANAGEMENT');
    this.name = 'TestManagementError';
  }
}
