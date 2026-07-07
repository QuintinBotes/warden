import { BrowserError, type RecordedSession, type SessionRecorder } from '@warden/core';
import { playwrightTraceSource, type RecordingSource } from './recording-source';

export interface RecorderOptions {
  /** The injectable capture backend. Defaults to {@link playwrightTraceSource}. */
  source?: RecordingSource;
  /**
   * Clock used for `startedAt` when the source does not report one. Injectable so tests never
   * depend on wall-clock time — library code never calls `Date.now()` on a path a test asserts.
   */
  clock?: () => Date;
}

/**
 * `PlaywrightSessionRecorder` is Warden's {@link SessionRecorder}. It is deliberately thin: it
 * delegates the actual browser driving to an injected {@link RecordingSource} and assembles the
 * result into a {@link RecordedSession}. `startedAt` is taken from the source's capture when
 * present, otherwise from the injected clock — never from an inline `Date.now()`.
 */
export class PlaywrightSessionRecorder implements SessionRecorder {
  private readonly source: RecordingSource;
  private readonly clock: () => Date;

  constructor(opts: RecorderOptions = {}) {
    this.source = opts.source ?? playwrightTraceSource();
    this.clock = opts.clock ?? (() => new Date());
  }

  async record(url: string, opts?: { maxSteps?: number }): Promise<RecordedSession> {
    if (!url || url.trim() === '') {
      throw new BrowserError('PlaywrightSessionRecorder.record requires a non-empty url.');
    }
    const maxSteps = opts?.maxSteps;
    const capture = await this.source.record(url, { maxSteps });
    const startedAt = capture.startedAt ?? this.clock();
    const steps = maxSteps != null ? capture.steps.slice(0, maxSteps) : capture.steps;
    return { url, startedAt, steps };
  }
}

/** Convenience factory mirroring the platform's `create*` style. */
export function createRecorder(opts?: RecorderOptions): SessionRecorder {
  return new PlaywrightSessionRecorder(opts);
}
