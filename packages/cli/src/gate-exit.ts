/**
 * The one place a `GateDecision` becomes a process exit code.
 *
 * `docs/cli.md` promises CI can fail a step on the exit code alone ("`1` — Gate decision
 * `BLOCK`, or a command error"), so every command that computes a gate has to run its
 * decision through here. Keeping the mapping in one function is what stops `run` and
 * `report aggregate` from drifting apart again: they blocked in their output and exited 0.
 */
import type { GateDecision } from '@warden/core';

/**
 * Exit code for a blocking gate. `1` and not a distinct code (2, 3, …) because the
 * documented contract is binary — a CI step either fails or it does not — and because
 * `set -e`, GitHub Actions steps and `npx` all treat any non-zero identically, so a
 * special code would buy nothing and break the documented table.
 */
export const GATE_BLOCK_EXIT_CODE = 1;

/**
 * The slice of `process` this module writes to. Injected so tests never touch the real one.
 * `null` is in the type because that is what `@types/node` says `process.exitCode` can be, and
 * the real `process` has to satisfy this interface.
 */
export interface ProcessLike {
  exitCode?: number | string | null | undefined;
}

/**
 * `1` when the gate blocks, `0` otherwise. `WARN` deliberately exits `0`: a warning that
 * fails the build is a block, and the gate has a separate decision for that.
 */
export function exitCodeForGate(gate: Pick<GateDecision, 'decision'>): number {
  return gate.decision === 'BLOCK' ? GATE_BLOCK_EXIT_CODE : 0;
}

/**
 * Applies {@link exitCodeForGate} to `proc`, but only ever upward: a non-blocking gate
 * never clears an exit code some earlier failure already set. Sets `exitCode` rather than
 * calling `process.exit`, so buffered stdout (the gate line the user needs to read) and any
 * pending teardown still flush.
 */
export function applyGateExitCode(
  gate: Pick<GateDecision, 'decision'>,
  proc: ProcessLike = process,
): void {
  const code = exitCodeForGate(gate);
  if (code !== 0) proc.exitCode = code;
}
