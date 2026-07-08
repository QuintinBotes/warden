import {
  BrowserError,
  type BrowserEngine,
  type VisualEngine,
  type WardenConfig,
} from '@warden/core';
import { PlaywrightVisualEngine } from './playwright-visual-engine.js';

/**
 * Wraps the already-selected `BrowserEngine` in a deterministic `VisualEngine`.
 *
 * V1 renders on a single engine (see the proposal's Non-Goals): only the Playwright engine is
 * supported, so a `claude-chrome`/`stagehand` selection throws a clear `BrowserError`. The
 * signature matches the `VisualEngineFactory` seam so the pipeline can inject a fake in tests and
 * this real factory in production.
 */
export function createVisualEngine(
  engine: BrowserEngine,
  visual: WardenConfig['visual'],
): VisualEngine {
  if (engine.name !== 'playwright') {
    throw new BrowserError(
      `Visual regression currently supports the "playwright" browser engine only; ` +
        `"${engine.name}" is not supported.`,
    );
  }
  return new PlaywrightVisualEngine(visual);
}
