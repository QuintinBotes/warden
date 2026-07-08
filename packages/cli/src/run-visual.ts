import {
  defineConfig,
  type GitHubAccess,
  type VisualBaseline,
  type VisualBaselineKey,
  type VisualBaselineStore,
  type WardenConfig,
} from '@warden/core';
import { GitBaselineStore, approveBaseline, nodeVisualFs } from '@warden/visual';

/** Options for `warden visual approve <module> [--viewport --theme --by]`. */
export interface RunVisualApproveOptions {
  /** The module whose baseline is being approved (e.g. `apps/checkout`). */
  module: string;
  /** Viewport name; defaults to `desktop`. */
  viewport?: string;
  /** Theme; defaults to `light`. */
  theme?: 'light' | 'dark';
  /** Who is approving (audit trail); defaults to `$GITHUB_ACTOR` or `warden-cli`. */
  by?: string;
}

/** Collaborators {@link runVisualApprove} can use instead of the real filesystem/GitHub. */
export interface RunVisualApproveDeps {
  /** Injected in tests instead of loading `warden.config.*`. */
  config?: WardenConfig;
  /** Injected in tests instead of a disk-backed {@link GitBaselineStore}. */
  store?: VisualBaselineStore;
  /** When present, the approved baseline PNG is committed on a draft PR. */
  gh?: GitHubAccess;
}

/** Result of an approve run. */
export interface RunVisualApproveResult {
  baseline: VisualBaseline;
  committed: boolean;
}

/**
 * Promotes a pending visual baseline to the committed baseline via `@warden/visual`'s
 * `approveBaseline`. The store defaults to a Git-file-backed {@link GitBaselineStore} under
 * `visual.baselinesDir`; tests inject an in-memory store. `approvedBy` is recorded for the audit
 * trail. When a `GitHubAccess` is injected, the promoted PNG is committed on a draft PR.
 */
export async function runVisualApprove(
  opts: RunVisualApproveOptions,
  deps: RunVisualApproveDeps = {},
): Promise<RunVisualApproveResult> {
  const cfg = deps.config ?? defineConfig();
  const store =
    deps.store ??
    new GitBaselineStore({ baselinesDir: cfg.visual.baselinesDir, fs: nodeVisualFs() });

  const key: VisualBaselineKey = {
    module: opts.module,
    viewport: opts.viewport ?? 'desktop',
    theme: opts.theme ?? 'light',
  };
  const approvedBy = opts.by ?? process.env.GITHUB_ACTOR ?? 'warden-cli';

  const result = await approveBaseline(key, approvedBy, store, deps.gh);
  return { baseline: result.baseline, committed: result.committed };
}
