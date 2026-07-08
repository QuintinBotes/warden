import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import type { VisualCheck, VisualEngine, VisualShot, WardenConfig } from '@warden/core';

/** CSS injected before capture to freeze animations/transitions/carets for a stable render. */
const FREEZE_CSS = [
  '*,*::before,*::after{',
  'animation:none!important;',
  'animation-duration:0s!important;',
  'transition:none!important;',
  'transition-duration:0s!important;',
  'scroll-behavior:auto!important;',
  'caret-color:transparent!important;',
  '}',
].join('');

/**
 * Deterministic Playwright-backed `VisualEngine`.
 *
 * Launches a single headless Chromium (lazily, reused across captures) and, per check, opens a
 * fresh context with the requested viewport + color scheme and reduced motion, navigates, waits
 * for network idle and web fonts, injects {@link FREEZE_CSS} to kill animation/caret jitter, masks
 * the configured dynamic regions, then screenshots the full page to in-memory PNG bytes.
 */
export class PlaywrightVisualEngine implements VisualEngine {
  readonly name = 'playwright-visual';
  private browser: Browser | null = null;

  constructor(private readonly visual: WardenConfig['visual']) {}

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  async capture(check: VisualCheck): Promise<VisualShot> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: check.viewport.width, height: check.viewport.height },
      colorScheme: check.theme,
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: check.theme, reducedMotion: 'reduce' });
      await page.goto(check.url, { waitUntil: 'networkidle' });
      // Wait for web fonts to settle. `document` lives in the browser context, not Node, so it is
      // reached via `globalThis` to avoid pulling the DOM lib into this package's typecheck.
      await page.evaluate(() => {
        const doc = (globalThis as { document?: { fonts?: { ready?: Promise<unknown> } } })
          .document;
        return doc?.fonts?.ready ?? null;
      });
      await page.addStyleTag({ content: FREEZE_CSS });

      const masks = [...this.visual.mask, ...(check.mask ?? [])];
      const png = await page.screenshot({
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        mask: masks.map((selector) => page.locator(selector)),
      });

      const bytes = new Uint8Array(png);
      const meta = PNG.sync.read(Buffer.from(png));
      return { check, png: bytes, width: meta.width, height: meta.height };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
