import type { ZodType } from 'zod';
import type { BrowserEngine, BrowserLaunchOptions, BrowserSession } from '@warden/core';
import { buildPlaywrightSession, type PlaywrightPage } from '../playwright-engine';

/**
 * The Stagehand engine — v2. A hybrid engine: deterministic interactions
 * (`goto`/`click`/`fill`/`screenshot`/`readPage`/`setViewport`) run on a real Playwright
 * page (imported lazily, so unit tests that never launch a browser need no binary), while the
 * AI-driven interactions (`act`/`extract`) are delegated to an INJECTED {@link StagehandLike}
 * client. Injecting the AI client keeps the engine hermetically unit-testable: a fake client
 * records the natural-language instructions and returns canned results with no model call.
 */

/**
 * The minimal Stagehand surface the engine needs. A concrete implementation wraps the real
 * `@browserbasehq/stagehand` client; unit tests supply a fake that records calls.
 */
export interface StagehandLike {
  /** Perform a natural-language action against the current page. */
  act(action: string): Promise<void>;
  /** Extract structured data described in natural language; returns opaque JSON. */
  extract(instruction: string): Promise<unknown>;
}

/**
 * Wrap a Playwright {@link PlaywrightPage} plus an injected {@link StagehandLike} client in a
 * Warden {@link BrowserSession}. Deterministic methods reuse {@link buildPlaywrightSession};
 * `act`/`extract` are overridden to delegate to Stagehand. `extract` validates the client's
 * opaque JSON against the caller's Zod schema so downstream code gets a typed, checked value.
 */
export function buildStagehandSession(
  page: PlaywrightPage,
  stagehand: StagehandLike,
  cleanup?: () => Promise<void>,
): BrowserSession {
  const base = buildPlaywrightSession(page, cleanup);
  return {
    ...base,
    async act(instruction: string) {
      await stagehand.act(instruction);
    },
    async extract<T>(instruction: string, schema: ZodType<T>): Promise<T> {
      return schema.parse(await stagehand.extract(instruction));
    },
  };
}

export class StagehandEngine implements BrowserEngine {
  readonly name = 'stagehand' as const;

  /**
   * @param stagehand The injected Stagehand client that powers `act`/`extract`.
   * @param mediaDir Directory where recorded video is written on `launch()`.
   */
  constructor(
    private readonly stagehand: StagehandLike,
    private readonly mediaDir: string = 'test-results/media',
  ) {}

  async launch(opts: BrowserLaunchOptions): Promise<BrowserSession> {
    // Lazy import: only pull in Playwright (and require a browser binary) when actually launching.
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: opts.headless });
    const context = await browser.newContext({
      viewport: opts.viewport,
      baseURL: opts.baseUrl,
      recordVideo: { dir: this.mediaDir },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeout);

    const cleanup = async () => {
      await context.close();
      await browser.close();
    };

    return buildStagehandSession(page as unknown as PlaywrightPage, this.stagehand, cleanup);
  }
}
