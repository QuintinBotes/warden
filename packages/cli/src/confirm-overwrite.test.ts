import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createOverwriteConfirm } from './confirm-overwrite';

/** Real streams driving a real readline; only the terminal itself is stood in for. */
function tty(isTTY: boolean): {
  input: PassThrough & { isTTY?: boolean };
  output: PassThrough & { isTTY?: boolean };
  written: () => string;
} {
  const input = Object.assign(new PassThrough(), { isTTY });
  const output = Object.assign(new PassThrough(), { isTTY });
  const chunks: string[] = [];
  output.on('data', (c: Buffer) => chunks.push(c.toString('utf-8')));
  return { input, output, written: () => chunks.join('') };
}

describe('createOverwriteConfirm', () => {
  it('does not ask when stdin is not a terminal, and answers no', async () => {
    const io = tty(false);
    const confirm = createOverwriteConfirm(io);

    await expect(confirm('/repo/warden.config.ts')).resolves.toBe(false);
    expect(io.written()).toBe('');
  });

  it('answers yes only for an explicit y', async () => {
    for (const [typed, expected] of [
      ['y\n', true],
      ['Y\n', true],
      ['yes\n', true],
      ['n\n', false],
      ['\n', false],
      ['no\n', false],
      ['sure\n', false],
    ] as const) {
      const io = tty(true);
      const answer = createOverwriteConfirm(io)('/repo/warden.config.ts');
      io.input.write(typed);
      await expect(answer).resolves.toBe(expected);
      expect(io.written()).toContain('Overwrite? [y/N]');
    }
  });

  it('treats end-of-input at the prompt as no instead of throwing', async () => {
    const io = tty(true);
    const answer = createOverwriteConfirm(io)('/repo/warden.config.ts');
    io.input.end(); // Ctrl+D

    await expect(answer).resolves.toBe(false);
  });
});
