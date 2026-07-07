import { BrowserError, type BrowserEngine, type WardenConfig } from '@warden/core';
import { PlaywrightEngine } from './playwright-engine';
import { ClaudeChromeEngine, type ClaudeChromeMcpClient } from './claude-chrome-engine';

/** Collaborators the engine factory can inject (e.g. the Claude-Chrome MCP client). */
export interface EngineDeps {
  mcpClient?: ClaudeChromeMcpClient;
}

/**
 * Select a {@link BrowserEngine} from the resolved `browser` config block:
 * - `playwright`    → {@link PlaywrightEngine} (CI default)
 * - `claude-chrome` → {@link ClaudeChromeEngine} (requires an injected `mcpClient`)
 * - `stagehand`     → throws; reserved for v2
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
      throw new BrowserError('the stagehand engine is not available until v2');
    default:
      throw new BrowserError(`unknown browser engine: ${String(browser.engine)}`);
  }
}
