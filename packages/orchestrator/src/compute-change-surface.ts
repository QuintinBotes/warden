import type { ChangeSurface, DiffFile, WardenConfig } from '@warden/core';
import { scoreRisk } from './score-risk';

/**
 * Turn a raw git diff into a {@link ChangeSurface}: which modules changed, which test tags
 * to run, whether shared/infra code was touched, and the overall risk. Pure — it takes an
 * explicit `DiffFile[]` so it needs no live git and is trivially testable.
 */

/** Matches paths whose module is derived from the first two path segments. */
const MODULE_PATH = /^(apps|src\/features)\//;

/** Matches a framework route file (e.g. `route.ts`, `route.tsx`). */
const ROUTE_FILE = /(^|\/)route\.(t|j)sx?$/;

function isSharedPath(path: string, cfg: WardenConfig): boolean {
  if (path.endsWith('.config.ts')) return true;
  return cfg.scope.sharedPaths.some((shared) => path.startsWith(shared));
}

function isApiRoute(path: string): boolean {
  return path.includes('/api/') || path.startsWith('api/') || ROUTE_FILE.test(path);
}

export function computeChangeSurface(files: DiffFile[], cfg: WardenConfig): ChangeSurface {
  const changedFiles = files.map((file) => file.path);

  const changedModules: string[] = [];
  for (const path of changedFiles) {
    if (!MODULE_PATH.test(path)) continue;
    const module = path.split('/').slice(0, 2).join('/');
    if (!changedModules.includes(module)) changedModules.push(module);
  }

  const testTags = changedModules.map((module) => cfg.scope.tagPrefix + module);
  const affectedApiRoutes = changedFiles.filter(isApiRoute);
  const hasSharedChanges = changedFiles.some((path) => isSharedPath(path, cfg));
  const { score, reasons } = scoreRisk(files, cfg);

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
  };
}
