/**
 * @warden/runner — browser engines (Playwright + Claude-Chrome) and CTRF conversion.
 *
 * The public surface is the engine factory ({@link createEngine}), the two concrete engines, the
 * pure Playwright→CTRF converter, and the integration runners that shell out to Playwright.
 */

export { createEngine, type EngineDeps } from './create-engine';
export { PlaywrightEngine } from './playwright-engine';
export { ClaudeChromeEngine, type ClaudeChromeMcpClient } from './claude-chrome-engine';
export { playwrightJsonToCtrf, type PlaywrightJsonToCtrfOptions } from './playwright-ctrf';
export { runPlaywright, runApiTests, type RunPlaywrightOptions } from './run-playwright';

// --- Work-stream A: stagehand + k6 + zap + appium ---

export { StagehandEngine, buildStagehandSession, type StagehandLike } from './engines/stagehand';

export {
  k6SummaryToCtrf,
  evaluateK6Thresholds,
  runK6,
  type K6Summary,
  type K6Metric,
  type K6ThresholdResult,
  type K6ThresholdConfig,
  type RunK6Options,
  type RunK6Result,
} from './perf/k6';

export {
  zapJsonToCtrf,
  evaluateZapGate,
  zapSeverityToGate,
  runZapBaseline,
  type ZapReport,
  type ZapSite,
  type ZapAlert,
  type ZapSeverity,
  type RunZapOptions,
  type RunZapResult,
} from './security/zap';

export {
  AppiumBrowserSession,
  createAppiumSession,
  type WebdriverLike,
  type WebdriverElementLike,
} from './mobile/appium';

export { expandMatrix, type RunMatrixConfig, type MatrixBrowser } from './matrix';
