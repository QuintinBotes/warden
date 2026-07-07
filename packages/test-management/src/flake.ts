import type { TestResult } from '@warden/core';

/** Fraction of `history` that are FAIL results; `0` for an empty history. */
export function computeFlakeRate(history: TestResult[]): number {
  if (history.length === 0) return 0;
  const fails = history.filter((r) => r.status === 'FAIL').length;
  return fails / history.length;
}

/** A test case should be quarantined once its flake rate lands strictly between 20% and 80%. */
export function shouldQuarantine(rate: number): boolean {
  return rate > 0.2 && rate < 0.8;
}
