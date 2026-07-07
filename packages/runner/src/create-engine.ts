import { BrowserError, type BrowserEngine, type WardenConfig } from '@warden/core';
import { PlaywrightEngine } from './playwright-engine';
import { ClaudeChromeEngine, type ClaudeChromeMcpClient } from './claude-chrome-engine';
import { StagehandEngine, type StagehandLike } from './engines/stagehand';

/** Collaborators the engine factory can inject (e.g. the Claude-Chrome MCP client). */
export interface EngineDeps {
  mcpClient?: ClaudeChromeMcpClient;
  /** The Stagehand client that powers the `stagehand` engine's `act`/`extract`. */
  stagehand?: StagehandLike;
}

/**
 * Select a {@link BrowserEngine} from the resolved `browser` config block:
 * - `playwright`    → {@link PlaywrightEngine} (CI default)
 * - `claude-chrome` → {@link ClaudeChromeEngine} (requires an injected `mcpClient`)
 * - `stagehand`     → {@link StagehandEngine} (v2; requires an injected `stagehand` client)
 */
export function createEngine(
  browser: WardenConfig['browser'],
  deps: EngineDeps = {},
): BrowserEngine {
  switch (browser.engine) {
    case 'playwright':
      return new PlaywrightEngine();
    case 'claude-chrome':
      if (!deps.mcpClient) {
        throw new BrowserError(
          'the claude-chrome engine requires an injected mcpClient (deps.mcpClient); it is local-first and not available in CI',
        );
      }
      return new ClaudeChromeEngine(deps.mcpClient);
    case 'stagehand':
      if (!deps.stagehand) {
        throw new BrowserError(
          'the stagehand engine requires an injected stagehand client (deps.stagehand)',
        );
      }
      return new StagehandEngine(deps.stagehand);
    default:
      throw new BrowserError(`unknown browser engine: ${String(browser.engine)}`);
  }
}
