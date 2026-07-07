import { BrowserError } from '@warden/core';

/**
 * Test-matrix expansion. Turns a browser (× optional device) matrix into the flat list of
 * Playwright project names a runner iterates over. Pure and deterministic.
 */

/** The Playwright-backed browsers Warden can target. */
export type MatrixBrowser = 'chromium' | 'firefox' | 'webkit';

const VALID_BROWSERS: readonly MatrixBrowser[] = ['chromium', 'firefox', 'webkit'];

/** Matrix definition: one or more browsers, optionally crossed with device/viewport labels. */
export interface RunMatrixConfig {
  browsers: MatrixBrowser[];
  /** Optional device/viewport labels crossed with each browser (e.g. `['desktop', 'mobile']`). */
  devices?: string[];
}

/**
 * Expand a {@link RunMatrixConfig} into ordered, de-duplicated project names. With no `devices`
 * the names are the browsers themselves (`['chromium', 'firefox']`); with devices each browser is
 * crossed with each device (`['chromium-desktop', 'chromium-mobile', ...]`). Throws a
 * {@link BrowserError} on an empty browser list or an unknown browser.
 */
export function expandMatrix(cfg: RunMatrixConfig): string[] {
  const browsers = cfg.browsers ?? [];
  if (browsers.length === 0) {
    throw new BrowserError('matrix requires at least one browser');
  }
  for (const browser of browsers) {
    if (!VALID_BROWSERS.includes(browser)) {
      throw new BrowserError(
        `unknown matrix browser: ${String(browser)} (expected chromium|firefox|webkit)`,
      );
    }
  }

  const devices = cfg.devices ?? [];
  const projects: string[] = [];
  for (const browser of browsers) {
    if (devices.length === 0) {
      projects.push(browser);
    } else {
      for (const device of devices) {
        projects.push(`${browser}-${device}`);
      }
    }
  }

  // De-duplicate while preserving first-seen order.
  return [...new Set(projects)];
}
