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
