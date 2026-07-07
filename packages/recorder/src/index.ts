/**
 * `@warden/recorder` (WS-E) — session recording and test synthesis. A
 * {@link PlaywrightSessionRecorder} captures a browser session into a `RecordedSession` via an
 * injectable {@link RecordingSource}; an {@link AiTestSynthesizer} turns that session into tagged
 * Playwright specs with role-based locators, deduping overlapping flows. Everything is built
 * against the `@warden/core` contract surface and is fully injectable, so it can be unit-tested
 * without a real LLM, browser, or network.
 */

// Recording source seam + default Playwright trace source
export {
  playwrightTraceSource,
  type BrowserLauncher,
  type PlaywrightTraceSourceOptions,
  type RecorderBrowser,
  type RecorderContext,
  type RecorderPage,
  type RecordingCapture,
  type RecordingOptions,
  type RecordingSource,
} from './recording-source';

// Session recorder
export {
  PlaywrightSessionRecorder,
  createRecorder,
  type RecorderOptions,
} from './playwright-session-recorder';

// Test synthesizer
export {
  AiTestSynthesizer,
  createSynthesizer,
  buildSynthesisPrompt,
  dedupeFlows,
  parseFlows,
  renderSpec,
  SynthFlowSchema,
  SynthResponseSchema,
  SynthStepSchema,
  type SynthesizerOptions,
  type SynthFlow,
  type SynthStep,
} from './ai-test-synthesizer';
