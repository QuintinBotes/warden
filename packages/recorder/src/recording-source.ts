import type { RecordedStep } from '@warden/core';

/**
 * A {@link RecordingSource} is the injectable seam between {@link PlaywrightSessionRecorder}
 * and whatever actually drives a browser. The recorder itself owns no Playwright dependency;
 * it merely asks a source to `record` a URL and hands back the captured steps. This keeps the
 * recorder unit-testable against a trivial fake source with no real browser, network, or
 * binary. The shipped default ({@link playwrightTraceSource}) lazily loads Playwright.
 */
export interface RecordingOptions {
  /** Upper bound on the number of steps a source should collect. */
  maxSteps?: number;
}

/** The raw capture a {@link RecordingSource} returns for a single session. */
export interface RecordingCapture {
  steps: RecordedStep[];
  /** Path to a recorded HAR bundle, when the source produced one. */
  harPath?: string;
  /**
   * When the source observed the session start itself, it may report it here so the
   * recorder does not have to consult its clock. Optional — the recorder falls back to
   * its injected clock when this is absent.
   */
  startedAt?: Date;
}

export interface RecordingSource {
  record(url: string, opts: RecordingOptions): Promise<RecordingCapture>;
}

/**
 * The structural subset of Playwright's `Page` the default source depends on. Kept structural
 * (like the runner's `PlaywrightPage`) so the source can be driven by a lightweight fake in
 * unit tests without a real browser.
 */
export interface RecorderPage {
  goto(url: string): Promise<unknown>;
  addInitScript(script: string): Promise<unknown>;
  exposeBinding(name: string, cb: (source: unknown, step: RecordedStep) => void): Promise<unknown>;
  /** Resolves when the human closes the page/browser — the natural end of a recording. */
  waitForEvent(event: 'close'): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface RecorderContext {
  newPage(): Promise<RecorderPage>;
  tracing: { start(opts: unknown): Promise<unknown>; stop(opts: unknown): Promise<unknown> };
  close(): Promise<unknown>;
}

export interface RecorderBrowser {
  newContext(opts: unknown): Promise<RecorderContext>;
  close(): Promise<unknown>;
}

/** Launches a browser. Injectable so the default source is hermetically testable. */
export type BrowserLauncher = (opts: { headless: boolean }) => Promise<RecorderBrowser>;

export interface PlaywrightTraceSourceOptions {
  /** Whether to launch headless. Interactive recording usually wants `false`. */
  headless?: boolean;
  /** Directory the HAR + trace bundle are written to. */
  mediaDir?: string;
  /** Injectable browser launcher; defaults to a lazily-imported Chromium. */
  launch?: BrowserLauncher;
}

/**
 * Injected into the page to capture interactions. Each click / change is reported back through
 * the `__wardenRecordStep` binding as a role-oriented {@link RecordedStep}.
 */
const CAPTURE_SCRIPT = `(() => {
  const describe = (el) => {
    if (!el || !el.tagName) return '';
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80);
    return name ? role + ':' + name : role;
  };
  document.addEventListener('click', (e) => {
    const t = e.target;
    window.__wardenRecordStep({
      action: 'click',
      selector: describe(t),
      value: (t.textContent || '').trim().slice(0, 80),
    });
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    window.__wardenRecordStep({ action: 'fill', selector: describe(t), value: t.value || '' });
  }, true);
})();`;

/**
 * Lazily loads Playwright and launches Chromium only when a recording actually starts, so unit
 * tests that never record against a real browser do not need one installed at import time.
 */
function lazyChromiumLauncher(): BrowserLauncher {
  return async ({ headless }) => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless });
    return browser as unknown as RecorderBrowser;
  };
}

/**
 * The default {@link RecordingSource}: drives a real browser, records a HAR + trace bundle, and
 * captures interactions via an injected page script until the human closes the browser. The
 * launcher is injectable, keeping the wiring testable without a real browser.
 */
export function playwrightTraceSource(cfg: PlaywrightTraceSourceOptions = {}): RecordingSource {
  const headless = cfg.headless ?? false;
  const mediaDir = cfg.mediaDir ?? 'test-results/recordings';
  const launch = cfg.launch ?? lazyChromiumLauncher();
  const harPath = `${mediaDir}/session.har`;

  return {
    async record(url, opts) {
      const steps: RecordedStep[] = [];
      const room = () => opts.maxSteps == null || steps.length < opts.maxSteps;

      const browser = await launch({ headless });
      try {
        const context = await browser.newContext({ recordHar: { path: harPath } });
        await context.tracing.start({ screenshots: true, snapshots: true });
        const page = await context.newPage();
        await page.exposeBinding('__wardenRecordStep', (_source, step) => {
          if (room()) steps.push(step);
        });
        await page.addInitScript(CAPTURE_SCRIPT);
        await page.goto(url);
        if (room()) steps.push({ action: 'goto', value: url });
        // Record until the operator closes the browser.
        await page.waitForEvent('close');
        await context.tracing.stop({ path: `${mediaDir}/trace.zip` });
        await context.close();
      } finally {
        await browser.close();
      }

      return { steps, harPath };
    },
  };
}
