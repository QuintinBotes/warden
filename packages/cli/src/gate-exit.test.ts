import { describe, expect, it } from 'vitest';
import { applyGateExitCode, exitCodeForGate, GATE_BLOCK_EXIT_CODE } from './gate-exit';

describe('exitCodeForGate', () => {
  it('maps BLOCK to a failing exit code and everything else to success', () => {
    expect(exitCodeForGate({ decision: 'BLOCK' })).toBe(GATE_BLOCK_EXIT_CODE);
    expect(GATE_BLOCK_EXIT_CODE).not.toBe(0);
    expect(exitCodeForGate({ decision: 'WARN' })).toBe(0);
    expect(exitCodeForGate({ decision: 'PASS' })).toBe(0);
  });
});

describe('applyGateExitCode', () => {
  it('sets the exit code on a blocking gate', () => {
    const proc: { exitCode?: number | string | null | undefined } = {};

    applyGateExitCode({ decision: 'BLOCK' }, proc);

    expect(proc.exitCode).toBe(1);
  });

  it('never clears an exit code an earlier failure already set', () => {
    const proc: { exitCode?: number | string | null | undefined } = { exitCode: 1 };

    applyGateExitCode({ decision: 'PASS' }, proc);

    expect(proc.exitCode).toBe(1);
  });
});
