import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfigWithSource, type ChangeSurface, type WardenConfig } from '@warden/core';
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
  /** Where an operator-facing warning goes. The CLI passes stderr; tests collect. */
  warn?: (message: string) => void;
}

/**
 * Resolves a `ChangeSurface` (from `deps.surface`, or by shelling out to
 * `@warden/orchestrator`'s `analyzeChangeSurface`) and renders it as GitHub-Actions
 * `key=value` output lines: `test_tags`, `risk_score`, `run_full_suite`, `configured`.
 *
 * `configured` is the provenance of the numbers above it. A repository with no `warden.config`
 * scores exactly like one whose config is empty, so without this line a consumer cannot tell a
 * deliberate low risk from a repository Warden was never configured for. An injected
 * `deps.config` counts as configured — the caller supplied one.
 *
 * The rendered content is always returned; if `output` is given it is additionally appended to
 * that file, matching the `$GITHUB_OUTPUT` convention.
 *
 * A surface that scoped to nothing carries a `scopeWarning`, which is written to stderr. The
 * output lines are left alone: a consumer parses them, and `test_tags=` with nothing after it
 * is still the honest answer — it is the reader who needs to be told why it is empty.
 */
export async function runAnalyze(
  opts: RunAnalyzeOptions,
  deps: RunAnalyzeDeps = {},
): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const loaded = deps.config
    ? { config: deps.config, configured: true, sourcePath: null }
    : await loadConfigWithSource(cwd);
  if (!loaded.configured) {
    deps.warn?.(
      `warden: no warden.config found in ${cwd} — the risk score and tier selection below are ` +
        `Warden's built-in defaults, not this repository's. Run \`warden init\` to configure it.`,
    );
  }
  const surface = deps.surface ?? analyzeChangeSurface(opts.base, opts.head, loaded.config, cwd);

  if (surface.scopeWarning) {
    const warn = deps.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
    warn(`warden analyze: ${surface.scopeWarning}`);
  }

  const lines = [
    `test_tags=${surface.testTags.join(' ')}`,
    `risk_score=${surface.riskScore}`,
    `run_full_suite=${surface.hasSharedChanges}`,
    `configured=${loaded.configured}`,
  ];
  const content = `${lines.join('\n')}\n`;

  if (opts.output) {
    await fs.mkdir(path.dirname(opts.output), { recursive: true });
    await fs.appendFile(opts.output, content, 'utf-8');
  }

  return content;
}
