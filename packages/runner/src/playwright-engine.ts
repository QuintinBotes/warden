import type { ZodType } from 'zod';
import {
  BrowserError,
  type BrowserEngine,
  type BrowserLaunchOptions,
  type BrowserSession,
} from '@warden/core';

/**
 * The Playwright engine — Warden's CI default. Deterministic, role-based interactions
 * (`goto`/`click`/`fill`) map onto Playwright's locator API; the AI actions (`act`/`extract`)
 * are unsupported here and throw, since they require the `claude-chrome` (or v2 `stagehand`)
 * engine. Playwright is imported lazily inside `launch()` so unit tests that never launch a
 * real browser do not need one installed at import time.
 */

/** A locator returned by Playwright's `getByRole` / `getByLabel`. */
export interface PlaywrightLocator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
}

/**
 * The structural subset of Playwright's `Page` that {@link buildPlaywrightSession} depends on.
 * Keeping it structural lets the mapping be unit-tested against a lightweight fake page with no
 * real browser.
 */
export interface PlaywrightPage {
  goto(url: string): Promise<unknown>;
  getByRole(role: string, options?: { name?: string }): PlaywrightLocator;
  getByLabel(label: string): PlaywrightLocator;
  screenshot(options: { path: string }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  innerText(selector: string): Promise<string>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
}

const NO_AI_ACTIONS =
  'requires the claude-chrome or stagehand engine; the playwright engine only supports deterministic interactions';

/**
 * Wrap a Playwright `Page` in a Warden {@link BrowserSession}. `cleanup` (when provided) tears
 * down the browser/context and is invoked on `close()`.
 */
export function buildPlaywrightSession(
  page: PlaywrightPage,
  cleanup?: () => Promise<void>,
): BrowserSession {
  return {
    async goto(url) {
      await page.goto(url);
    },
    async click(role, name) {
      await page.getByRole(role, { name }).click();
    },
    async fill(label, value) {
      await page.getByLabel(label).fill(value);
    },
    async act() {
      throw new BrowserError(`act() ${NO_AI_ACTIONS}`);
    },
    async extract<T>(_instruction: string, _schema: ZodType<T>): Promise<T> {
      throw new BrowserError(`extract() ${NO_AI_ACTIONS}`);
    },
    async screenshot(path) {
      await page.screenshot({ path });
    },
    async readPage() {
      return { url: page.url(), title: await page.title(), text: await page.innerText('body') };
    },
    async setViewport(width, height) {
      await page.setViewportSize({ width, height });
    },
    async close() {
      if (cleanup) await cleanup();
    },
  };
}

export class PlaywrightEngine implements BrowserEngine {
  readonly name = 'playwright' as const;

  /** Directory where recorded video and the trace bundle are written. */
  constructor(private readonly mediaDir: string = 'test-results/media') {}

  async launch(opts: BrowserLaunchOptions): Promise<BrowserSession> {
    // Lazy import: only pull in Playwright (and require a browser binary) when actually launching.
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: opts.headless });
    // Record video for the whole context and start a trace with screenshots so the dashboard's
    // E2E replay (WS2-20) has media to show for every result.
    const context = await browser.newContext({
      viewport: opts.viewport,
      baseURL: opts.baseUrl,
      recordVideo: { dir: this.mediaDir },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.setDefaultTimeout(opts.timeout);

    const cleanup = async () => {
      try {
        await context.tracing.stop({ path: `${this.mediaDir}/trace.zip` });
      } catch {
        // tracing may not have started cleanly; tearing down regardless.
      }
      await context.close();
      await browser.close();
    };

    return buildPlaywrightSession(page as unknown as PlaywrightPage, cleanup);
  }
}
