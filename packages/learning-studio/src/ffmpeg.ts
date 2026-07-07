import { WardenError } from '@warden/core';

/**
 * Video-stitching seam. Turning captured screenshots/clips into a single learning video
 * shells out to `ffmpeg`, which is slow, environment-dependent, and never wanted in a unit
 * test. The studio depends only on this minimal interface; tests inject a fake that records
 * the args and returns immediately.
 */
export interface FfmpegRunner {
  run(args: string[]): Promise<void>;
}

/** An ffmpeg invocation failed. */
export class FfmpegError extends WardenError {
  constructor(message: string) {
    super(message, 'E_FFMPEG');
  }
}

/**
 * Default {@link FfmpegRunner} that shells out to a real `ffmpeg` binary via
 * `node:child_process`. Never invoked in unit tests (they inject a fake runner).
 */
export function defaultFfmpegRunner(binary = 'ffmpeg'): FfmpegRunner {
  return {
    async run(args) {
      const { execFile } = await import('node:child_process');
      await new Promise<void>((resolve, reject) => {
        execFile(binary, args, (error) => {
          if (error) {
            reject(new FfmpegError(`ffmpeg exited with an error: ${error.message}`));
          } else {
            resolve();
          }
        });
      });
    },
  };
}

/**
 * Builds the ffmpeg argument vector that stitches the captured media for a flow into a
 * single output video. Each source (recorded video clips first, then screenshots) becomes an
 * input; the result is written to `output`. Deterministic given the same inputs.
 */
export function buildFfmpegArgs(sources: string[], output: string): string[] {
  const args: string[] = [];
  for (const source of sources) {
    args.push('-i', source);
  }
  // Overwrite any stale output so re-runs are idempotent.
  args.push('-y', output);
  return args;
}
