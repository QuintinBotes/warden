import type { ChangeSurface, DiffFile, WardenConfig } from '@warden/core';
import { scoreRisk } from './score-risk';

/**
 * Turn a raw git diff into a {@link ChangeSurface}: which modules changed, which test tags
 * to run, whether shared/infra code was touched, and the overall risk. Pure — it takes an
 * explicit `DiffFile[]` so it needs no live git and is trivially testable.
 */

/** Matches a framework route file (e.g. `route.ts`, `route.tsx`). */
const ROUTE_FILE = /(^|\/)route\.(t|j)sx?$/;

/**
 * A module root as it is compared against a path: trailing slash forced, so `internal`
 * matches `internal/billing/x.go` and not `internals-notes/README.md`. A leading `./` is
 * dropped because that is how people write a prefix in a config file.
 */
function normalizeModulePath(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\.\//, '');
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function isSharedPath(path: string, cfg: WardenConfig): boolean {
  if (path.endsWith('.config.ts')) return true;
  return cfg.scope.sharedPaths.some((shared) => path.startsWith(shared));
}

function isApiRoute(path: string): boolean {
  return path.includes('/api/') || path.startsWith('api/') || ROUTE_FILE.test(path);
}

export function computeChangeSurface(files: DiffFile[], cfg: WardenConfig): ChangeSurface {
  const changedFiles = files.map((file) => file.path);
  const modulePaths = cfg.scope.modulePaths.map(normalizeModulePath);

  const changedModules: string[] = [];
  for (const path of changedFiles) {
    if (!modulePaths.some((prefix) => path.startsWith(prefix))) continue;
    // The module is the first two path segments; `scope.modulePaths` decides which trees
    // are searched, not how deep a module sits inside them.
    const module = path.split('/').slice(0, 2).join('/');
    if (!changedModules.includes(module)) changedModules.push(module);
  }

  const testTags = changedModules.map((module) => cfg.scope.tagPrefix + module);
  const affectedApiRoutes = changedFiles.filter(isApiRoute);
  const hasSharedChanges = changedFiles.some((path) => isSharedPath(path, cfg));
  const { score, reasons } = scoreRisk(files, cfg);

  // An empty diff selects nothing because there is nothing to select; a non-empty diff that
  // selects nothing is either a docs-only change or a repo whose modules Warden was never
  // told about. Both are worth saying out loud — an empty `test_tags=` reaches Playwright as
  // no `--grep` at all, which runs everything under the name "selective".
  const scopeWarning =
    changedFiles.length > 0 && changedModules.length === 0
      ? `No changed file is under any scope.modulePaths prefix (${modulePaths.join(', ')}), ` +
        `so the selective tier has no tags for this diff. If this repo's modules do not live ` +
        `there, set scope.modulePaths in warden.config.ts to the roots they do live under.`
      : undefined;

  return {
    changedFiles,
    changedModules,
    testTags,
    hasSharedChanges,
    affectedApiRoutes,
    // Component mapping is best-effort and left to a later wave; empty for now.
    affectedComponents: [],
    riskScore: score,
    riskReasons: reasons,
    ...(scopeWarning ? { scopeWarning } : {}),
  };
}
