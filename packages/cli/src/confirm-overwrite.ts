import { createInterface } from 'node:readline/promises';

/** The pair of streams a confirmation prompt reads and writes. */
export interface ConfirmIo {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream & { isTTY?: boolean };
}

/**
 * Builds the `confirmOverwrite` callback `warden init` hands to `runInit`.
 *
 * Both ends have to be a terminal. A piped or redirected `init` — CI, `npx warden init` in a
 * script, `< /dev/null` — has nobody to ask, and an unanswerable question must not become an
 * assumed yes: it answers `false`, and the caller reports the file as kept.
 */
export function createOverwriteConfirm(io: ConfirmIo): (filePath: string) => Promise<boolean> {
  return async (filePath: string): Promise<boolean> => {
    if (io.input.isTTY !== true || io.output.isTTY !== true) return false;

    const rl = createInterface({ input: io.input, output: io.output });
    // A terminal can end under a pending question in two different ways, and both have to
    // stop waiting: Ctrl+D on a raw TTY rejects the question, while an input stream that
    // simply ends only closes the interface — without this the prompt would wait forever
    // for a line that can no longer arrive.
    const ended = new AbortController();
    rl.once('close', () => ended.abort());
    try {
      const answer = await rl.question(
        `${filePath} exists and differs from the template. Overwrite? [y/N] `,
        { signal: ended.signal },
      );
      // Default no: only an explicit yes replaces a file the user has edited.
      return /^y(es)?$/i.test(answer.trim());
    } catch {
      // Nobody who closed the prompt agreed to anything, so it reads as "no" rather than as
      // a crash part-way through the scaffold.
      return false;
    } finally {
      rl.close();
    }
  };
}
