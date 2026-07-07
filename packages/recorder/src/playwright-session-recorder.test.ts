import { describe, expect, it } from 'vitest';
import { BrowserError, type RecordedStep } from '@warden/core';
import { PlaywrightSessionRecorder, createRecorder } from './playwright-session-recorder';
import {
  playwrightTraceSource,
  type BrowserLauncher,
  type RecordingCapture,
  type RecordingSource,
} from './recording-source';

/** A trivial in-memory source: no browser, no network. */
function fakeSource(capture: RecordingCapture): RecordingSource {
  return {
    async record() {
      return capture;
    },
  };
}

const CLICK_STEPS: RecordedStep[] = [
  { action: 'goto', value: 'https://app.test/checkout' },
  { action: 'click', selector: 'button:Add to cart', value: 'Add to cart' },
  { action: 'fill', selector: 'input:Email', value: 'a@b.com' },
  { action: 'click', selector: 'button:Pay', value: 'Pay' },
];

describe('PlaywrightSessionRecorder', () => {
  it('builds a RecordedSession from a faked source and an injected clock', async () => {
    const startedAt = new Date('2026-07-07T09:00:00.000Z');
    const recorder = createRecorder({
      source: fakeSource({ steps: CLICK_STEPS }),
      clock: () => startedAt,
    });

    const session = await recorder.record('https://app.test/checkout');

    expect(session.url).toBe('https://app.test/checkout');
    expect(session.startedAt).toBe(startedAt);
    expect(session.steps).toEqual(CLICK_STEPS);
  });

  it('never reads wall-clock time when the source reports startedAt', async () => {
    const sourceStart = new Date('2020-01-01T00:00:00.000Z');
    const recorder = new PlaywrightSessionRecorder({
      source: fakeSource({ steps: CLICK_STEPS, startedAt: sourceStart }),
      clock: () => {
        throw new Error('clock must not be consulted when the source reports startedAt');
      },
    });

    const session = await recorder.record('https://app.test/');
    expect(session.startedAt).toBe(sourceStart);
  });

  it('truncates to maxSteps', async () => {
    const recorder = createRecorder({
      source: fakeSource({ steps: CLICK_STEPS }),
      clock: () => new Date('2026-07-07T09:00:00.000Z'),
    });

    const session = await recorder.record('https://app.test/checkout', { maxSteps: 2 });
    expect(session.steps).toHaveLength(2);
    expect(session.steps).toEqual(CLICK_STEPS.slice(0, 2));
  });

  it('throws a BrowserError on an empty url', async () => {
    const recorder = createRecorder({ source: fakeSource({ steps: [] }) });
    await expect(recorder.record('')).rejects.toBeInstanceOf(BrowserError);
  });
});

/**
 * Drives the default {@link playwrightTraceSource} with a fully faked browser (no real Chromium),
 * exercising the exposed-binding capture path and HAR wiring hermetically.
 */
function fakeLauncher(simulated: RecordedStep[]): BrowserLauncher {
  return async () => {
    let boundCb: ((source: unknown, step: RecordedStep) => void) | undefined;
    const page = {
      async goto() {},
      async addInitScript() {},
      async exposeBinding(_name: string, cb: (source: unknown, step: RecordedStep) => void) {
        boundCb = cb;
      },
      async waitForEvent() {
        // Simulate the operator interacting, then closing the browser.
        for (const step of simulated) boundCb?.({}, step);
      },
      async close() {},
    };
    const context = {
      async newPage() {
        return page;
      },
      tracing: { async start() {}, async stop() {} },
      async close() {},
    };
    const browser = {
      async newContext() {
        return context;
      },
      async close() {},
    };
    return browser;
  };
}

describe('playwrightTraceSource (default source)', () => {
  it('captures goto plus interactions through the exposed binding and reports a HAR path', async () => {
    const source = playwrightTraceSource({
      headless: true,
      launch: fakeLauncher([
        { action: 'click', selector: 'button:Pay', value: 'Pay' },
        { action: 'fill', selector: 'input:Email', value: 'a@b.com' },
      ]),
    });

    const capture = await source.record('https://app.test/', { maxSteps: 10 });

    expect(capture.steps[0]).toEqual({ action: 'goto', value: 'https://app.test/' });
    expect(capture.steps).toContainEqual({
      action: 'click',
      selector: 'button:Pay',
      value: 'Pay',
    });
    expect(capture.steps).toContainEqual({
      action: 'fill',
      selector: 'input:Email',
      value: 'a@b.com',
    });
    expect(capture.harPath).toMatch(/\.har$/);
  });

  it('honours maxSteps while capturing', async () => {
    const source = playwrightTraceSource({
      launch: fakeLauncher([
        { action: 'click', selector: 'a', value: 'one' },
        { action: 'click', selector: 'b', value: 'two' },
      ]),
    });

    const capture = await source.record('https://app.test/', { maxSteps: 2 });
    // goto + first click fit; the second click is dropped by the cap.
    expect(capture.steps).toHaveLength(2);
    expect(capture.steps[0]).toEqual({ action: 'goto', value: 'https://app.test/' });
  });
});
