import { execFileSync } from 'node:child_process';
import { WardenError } from '@warden/core';
import type { ChangeSurface, DiffFile, WardenConfig } from '@warden/core';
import { computeChangeSurface } from './compute-change-surface';

/**
 * Integration glue: shell out to `git diff --name-status <base> <head>` to build the
 * `DiffFile[]`, then delegate to the pure {@link computeChangeSurface}. This is the only
 * function in the package that touches the environment, so it is intentionally thin and is
 * covered by integration (not unit) tests.
 */

const STATUS_MAP: Record<string, DiffFile['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'added',
};

/** Parse the porcelain output of `git diff --name-status` into `DiffFile[]`. */
export function parseNameStatus(output: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const parts = trimmed.split('\t');
    const code = parts[0]?.[0] ?? 'M';
    const status = STATUS_MAP[code] ?? 'modified';
    // For renames/copies git emits `R100\told\tnew`; the destination is the last field.
    const path = parts[parts.length - 1];
    if (path === undefined || path === '') continue;

    files.push({ path, status });
  }
  return files;
}

export function analyzeChangeSurface(
  baseSha: string,
  headSha: string,
  cfg: WardenConfig,
  cwd: string = process.cwd(),
): ChangeSurface {
  let output: string;
  try {
    output = execFileSync('git', ['diff', '--name-status', baseSha, headSha], {
      cwd,
      encoding: 'utf8',
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new WardenError(
      `Failed to run \`git diff --name-status ${baseSha} ${headSha}\`: ${message}`,
      'GIT_DIFF_FAILED',
    );
  }

  return computeChangeSurface(parseNameStatus(output), cfg);
}
