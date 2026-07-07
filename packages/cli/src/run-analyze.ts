import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig, type ChangeSurface, type WardenConfig } from '@warden/core';
import { analyzeChangeSurface } from '@warden/orchestrator';

/** Options for {@link runAnalyze}. */
export interface RunAnalyzeOptions {
  /** Base git ref/sha to diff from. */
  base: string;
  /** Head git ref/sha to diff to. */
  head: string;
  /** Working directory the diff is computed in. Defaults to `process.cwd()`. */
  cwd?: string;
  /** If given, the GitHub-Actions output lines are appended to this file (`$GITHUB_OUTPUT`). */
  output?: string;
}

/** Collaborators {@link runAnalyze} can use instead of touching real git/config. */
export interface RunAnalyzeDeps {
  /** Injected in tests instead of loading `warden.config.*` from disk. */
  config?: WardenConfig;
  /** Injected in tests instead of shelling out to `analyzeChangeSurface`. */
  surface?: ChangeSurface;
}

/**
 * Resolves a `ChangeSurface` (from `deps.surface`, or by shelling out to
 * `@warden/orchestrator`'s `analyzeChangeSurface`) and renders it as GitHub-Actions
 * `key=value` output lines: `test_tags`, `risk_score`, `run_full_suite`.
 *
 * The rendered content is always returned; if `output` is given it is additionally appended to
 * that file, matching the `$GITHUB_OUTPUT` convention.
 */
export async function runAnalyze(
  opts: RunAnalyzeOptions,
  deps: RunAnalyzeDeps = {},
): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const surface =
    deps.surface ??
    analyzeChangeSurface(opts.base, opts.head, deps.config ?? (await loadConfig(cwd)), cwd);

  const lines = [
    `test_tags=${surface.testTags.join(' ')}`,
    `risk_score=${surface.riskScore}`,
    `run_full_suite=${surface.hasSharedChanges}`,
  ];
  const content = `${lines.join('\n')}\n`;

  if (opts.output) {
    await fs.mkdir(path.dirname(opts.output), { recursive: true });
    await fs.appendFile(opts.output, content, 'utf-8');
  }

  return content;
}
