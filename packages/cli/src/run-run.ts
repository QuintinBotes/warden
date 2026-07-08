import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  contentId,
  createLogger,
  loadConfig,
  ProviderError,
  type CTRFReport,
  type FailureContext,
  type FlakeClassification,
  type FlakeClassifier,
  type GateDecision,
  type LLMProvider,
  type Logger,
  type MetricsEmitter,
  type ReportContext,
  type Reporter,
  type TestExecution,
  type TestResult,
  type WardenConfig,
} from '@warden/core';
import { runPlaywright, type RunPlaywrightOptions } from '@warden/runner';
import { computeGateDecision, createReporters, type CreateReportersDeps } from '@warden/reporter';
import { firePluginHooks } from '@warden/orchestrator';
import {
  computeFlakeRate,
  reconcileRetries,
  selectRetryCandidates,
  shouldQuarantine,
  type SqliteStore,
} from '@warden/test-management';
import { createFlakeClassifier, createProvider } from '@warden/agent';
import { ctrfToExecution } from './ctrf-execution';

/** How many recent executions to consider when computing a test case's flake history. */
const HISTORY_LIMIT = 1000;

/** A `MetricsEmitter` that may implement the optional flake-classification method. */
type FlakeAwareMetricsEmitter = MetricsEmitter & {
  emitFlakeClassification?: (classification: FlakeClassification) => Promise<void>;
};

/** Provider used only when none is injected and one cannot be constructed: forces the heuristic. */
const OFFLINE_PROVIDER: LLMProvider = {
  name: 'offline',
  async generateText() {
    throw new ProviderError('No LLM provider configured for flake classification.');
  },
  async generateWithTools() {
    throw new ProviderError('No LLM provider configured for flake classification.');
  },
};

/** Options for {@link runRun}. */
export interface RunRunOptions {
  /** Playwright `--grep` filter (e.g. a tier tag like `@smoke`). */
  grep?: string;
  /** Working directory tests run in. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Directory the CTRF report and reporter artifacts are written to. */
  artifactsDir: string;
}

/** Collaborators {@link runRun} can use instead of touching a real browser/GitHub. */
export interface RunRunDeps {
  /** Injected in tests instead of loading `warden.config.*` from disk. */
  config?: WardenConfig;
  /** Injected in tests instead of `@warden/runner`'s `runPlaywright`. */
  runTests?: (opts: { grep?: string; cwd?: string }) => Promise<CTRFReport>;
  /** Injected in tests instead of `createReporters(cfg)`. */
  reporters?: Reporter[];
  /** Forwarded to `createReporters` when `reporters` is not injected. */
  reporterDeps?: CreateReportersDeps;
  /**
   * Execution-history store. Present, the flake-intelligence pass runs: a bounded, backed-off
   * retry of failing tests, then classification, quarantine-event logging, and metrics. Absent
   * (the default), `runRun` behaves exactly as before — a single tier run, no retries.
   */
  store?: SqliteStore;
  /** Emitter for flake-classification metrics (no-op if it lacks the optional method). */
  metricsEmitter?: FlakeAwareMetricsEmitter;
  /** Root-cause classifier. Defaults to `createFlakeClassifier()`. */
  classifier?: FlakeClassifier;
  /** LLM provider for the classifier. Defaults to one built from `cfg.ai`, else an offline stub. */
  provider?: LLMProvider;
  /** Backoff sleep between retry rounds. Injected in tests to avoid real delays. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock for quarantine-event timestamps. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Where storage-degradation warnings go. Defaults to a console logger. */
  logger?: Logger;
  prNumber?: number;
  headSha?: string;
  repo?: ReportContext['repo'];
}

/** Return value of {@link runRun}. */
export interface RunRunResult {
  /** The (reconciled, if retries fired) CTRF report written to disk. */
  report: CTRFReport;
  /** The report converted into a Warden `TestExecution` and handed to each reporter. */
  execution: TestExecution;
  /** Where the CTRF report was written on disk. */
  ctrfPath: string;
  /** The gate decision derived from `execution` and handed to `cfg.plugins` via `onGateDecision`. */
  gate: GateDecision;
}

/** Stable CTRF test identity — mirrors `ctrfToExecution` so ids line up. */
function ctrfIdentity(test: CTRFReport['results']['tests'][number]): string {
  return test.filePath ? `${test.filePath}::${test.name}` : test.name;
}

/** Flake rate counting both hard FAILs and results that flaked to a non-FAIL. */
function flakeRateWithFlags(history: TestResult[]): number {
  if (history.length === 0) return 0;
  const flaky = history.filter((r) => r.status === 'FAIL' || r.flakeFlag).length;
  return flaky / history.length;
}

/** Failure contexts from the first attempt, keyed by `testCaseId`, for the classifier. */
function collectFirstFailures(report: CTRFReport): Map<string, FailureContext> {
  const map = new Map<string, FailureContext>();
  for (const test of report.results.tests) {
    if (test.status !== 'failed') continue;
    const id = contentId('TC', ctrfIdentity(test));
    const failure: FailureContext = { testCode: '', errorMessage: test.message ?? '' };
    if (test.trace) failure.stackTrace = test.trace;
    map.set(id, failure);
  }
  return map;
}

/** The set of requirement-linked test case ids whose history currently lands in quarantine. */
function buildKnownFlaky(store: SqliteStore): Set<string> {
  const known = new Set<string>();
  const seen = new Set<string>();
  for (const req of store.getRequirements()) {
    for (const testCaseId of req.linkedTestIds) {
      if (seen.has(testCaseId)) continue;
      seen.add(testCaseId);
      const rate = computeFlakeRate(store.getRecentExecutions(testCaseId, HISTORY_LIMIT));
      if (shouldQuarantine(rate)) known.add(testCaseId);
    }
  }
  return known;
}

/**
 * Runs bounded, backed-off retry rounds over the failing subset of the previous attempt, scoped by
 * `selectRetryCandidates`. Returns the original report followed by each retry-attempt report (an
 * array of length 1 when nothing was retried).
 */
async function runRetryRounds(
  firstReport: CTRFReport,
  cfg: WardenConfig,
  store: SqliteStore,
  runTests: (opts: { grep?: string; cwd?: string }) => Promise<CTRFReport>,
  cwd: string,
  sleep: (ms: number) => Promise<void>,
): Promise<CTRFReport[]> {
  const retry = cfg.flake.retry;
  const attempts: CTRFReport[] = [firstReport];
  const knownFlaky = buildKnownFlaky(store);
  let lastReport = firstReport;

  for (let attempt = 0; attempt < retry.maxRetries; attempt++) {
    const failed = lastReport.results.tests.filter((t) => t.status === 'failed');
    if (failed.length === 0) break;

    const idToName = new Map<string, string>();
    const failedIds: string[] = [];
    for (const test of failed) {
      const id = contentId('TC', ctrfIdentity(test));
      failedIds.push(id);
      idToName.set(id, test.name);
    }

    const candidateIds = selectRetryCandidates(failedIds, {
      retryOnlyKnownFlaky: retry.retryOnlyKnownFlaky,
      knownFlaky,
    });
    if (candidateIds.length === 0) break;

    const grep = candidateIds
      .map((id) => idToName.get(id))
      .filter((name): name is string => Boolean(name))
      .join('|');

    const delay = retry.backoffMs * Math.pow(retry.backoffMultiplier, attempt);
    if (delay > 0) await sleep(delay);

    const retryReport = await runTests({ grep, cwd });
    attempts.push(retryReport);
    lastReport = retryReport;
  }

  return attempts;
}

/** Builds the classifier's provider, degrading to an offline stub if none can be constructed. */
function resolveProvider(deps: RunRunDeps, cfg: WardenConfig): LLMProvider {
  if (deps.provider) return deps.provider;
  try {
    return createProvider(cfg.ai);
  } catch {
    return OFFLINE_PROVIDER;
  }
}

/**
 * Persists the execution, then for each newly-flaky test: records any quarantine-state flip,
 * classifies its root cause (LLM + heuristic fallback), and pushes classification metrics. Every
 * storage/metric step is independently failable and only warns — it never fails the tier run.
 * Returns the number of tests newly moved into quarantine this run.
 */
async function reconcileFlakeState(
  execution: TestExecution,
  cfg: WardenConfig,
  deps: RunRunDeps,
  firstFailures: Map<string, FailureContext>,
): Promise<number> {
  const store = deps.store;
  if (!store) return 0;
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? createLogger();
  const emitter = deps.metricsEmitter;
  const flakyResults = execution.results.filter((r) => r.flakeFlag);

  // Snapshot quarantine state from prior history BEFORE this run is persisted.
  const prevState = new Map<string, boolean>();
  for (const r of flakyResults) {
    const history = store.getRecentExecutions(r.testCaseId, HISTORY_LIMIT);
    prevState.set(r.testCaseId, shouldQuarantine(flakeRateWithFlags(history)));
  }

  try {
    store.saveExecution(execution);
  } catch (err) {
    logger.warn('Failed to persist execution; skipping flake reconciliation.', err);
    return 0;
  }

  const classifier = deps.classifier ?? createFlakeClassifier();
  const provider = cfg.flake.classifier.enabled ? resolveProvider(deps, cfg) : OFFLINE_PROVIDER;

  let newlyQuarantined = 0;
  for (const r of flakyResults) {
    const history = store.getRecentExecutions(r.testCaseId, HISTORY_LIMIT);
    const nowQuarantined = shouldQuarantine(flakeRateWithFlags(history));
    const prevQuarantined = prevState.get(r.testCaseId) ?? false;
    if (nowQuarantined !== prevQuarantined) {
      try {
        store.recordQuarantineEvent({
          testCaseId: r.testCaseId,
          event: nowQuarantined ? 'quarantined' : 'cleared',
          at: now(),
        });
      } catch (err) {
        logger.warn(`Failed to record quarantine event for ${r.testCaseId}.`, err);
      }
      if (nowQuarantined) newlyQuarantined += 1;
    }

    if (!cfg.flake.classifier.enabled) continue;
    const recentResults = history.slice().reverse(); // chronological, most recent last
    const latestFailure = firstFailures.get(r.testCaseId) ?? {
      testCode: '',
      errorMessage: r.errorMessage ?? '',
    };
    try {
      const classification = await classifier.classify(
        { testCaseId: r.testCaseId, recentResults, latestFailure },
        provider,
        cfg,
      );
      try {
        store.saveFlakeClassification(classification);
      } catch (err) {
        logger.warn(`Failed to save classification for ${r.testCaseId}.`, err);
      }
      try {
        await emitter?.emitFlakeClassification?.(classification);
      } catch (err) {
        logger.warn(`Failed to emit classification metrics for ${r.testCaseId}.`, err);
      }
    } catch (err) {
      logger.warn(`Flake classification failed for ${r.testCaseId}.`, err);
    }
  }

  return newlyQuarantined;
}

/**
 * Runs tests via the injected (or real Playwright) runner, writes the resulting CTRF report to
 * `artifactsDir/ctrf-report.json`, converts it into a `TestExecution`, and hands that execution
 * to every reporter (injected, or selected from config via `createReporters`).
 *
 * When a `store` is injected and `cfg.flake.retry.enabled`, a flake-intelligence pass runs first:
 * failing tests are retried with exponential backoff (scoped by `retryOnlyKnownFlaky`), the
 * attempts are reconciled into one report stamped with real `retries`/`flakeFlag`, newly-flaky
 * tests are classified and their quarantine-state transitions logged, and a run that newly
 * quarantines more than `cfg.flake.gate.warnOnNewlyQuarantinedAbove` tests raises a WARN (never a
 * BLOCK on its own).
 */
export async function runRun(opts: RunRunOptions, deps: RunRunDeps = {}): Promise<RunRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = deps.config ?? (await loadConfig(cwd));
  const runTests = deps.runTests ?? ((runOpts: RunPlaywrightOptions) => runPlaywright(runOpts));

  const firstReport = await runTests({ grep: opts.grep, cwd });
  const firstFailures = collectFirstFailures(firstReport);

  let finalReport = firstReport;
  let retryMeta: Map<string, { retries: number; flakeFlag: boolean }> | undefined;
  if (deps.store && cfg.flake.retry.enabled) {
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const attempts = await runRetryRounds(firstReport, cfg, deps.store, runTests, cwd, sleep);
    if (attempts.length > 1) {
      const reconciliation = reconcileRetries(attempts);
      finalReport = reconciliation.report;
      retryMeta = reconciliation.meta;
    }
  }

  await fs.mkdir(opts.artifactsDir, { recursive: true });
  const ctrfPath = path.join(opts.artifactsDir, 'ctrf-report.json');
  await fs.writeFile(ctrfPath, JSON.stringify(finalReport, null, 2), 'utf-8');

  const execution = ctrfToExecution(finalReport, {
    triggerRef: opts.grep ?? 'all',
    triggerType: 'manual',
    ...(retryMeta !== undefined && { retryMeta }),
  });

  await firePluginHooks(cfg.plugins, {
    hook: 'onTestExecutionComplete',
    execution,
    results: execution.results,
  });

  const reporters = deps.reporters ?? createReporters(cfg, deps.reporterDeps);
  const ctx: ReportContext = {
    config: cfg,
    artifactsDir: opts.artifactsDir,
    ...(deps.prNumber !== undefined && { prNumber: deps.prNumber }),
    ...(deps.headSha !== undefined && { headSha: deps.headSha }),
    ...(deps.repo !== undefined && { repo: deps.repo }),
  };

  for (const reporter of reporters) {
    await reporter.report(execution, ctx);
  }

  let gate = computeGateDecision(execution);

  if (deps.store) {
    const newlyQuarantined = await reconcileFlakeState(execution, cfg, deps, firstFailures);
    if (
      newlyQuarantined > cfg.flake.gate.warnOnNewlyQuarantinedAbove &&
      gate.decision !== 'BLOCK'
    ) {
      gate = {
        decision: 'WARN',
        reason: `${newlyQuarantined} test(s) newly quarantined this run`,
      };
    }
  }

  await firePluginHooks(cfg.plugins, { hook: 'onGateDecision', decision: gate });

  return { report: finalReport, execution, ctrfPath, gate };
}
