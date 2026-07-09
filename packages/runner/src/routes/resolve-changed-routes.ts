import type { ChangeSurface } from '@warden/core';

/**
 * One entry of `cfg.a11y.routes` / `cfg.performance.browser.routes`: a prefix match against a
 * changed file or module, and the URL pattern it resolves to (`*` is replaced with whatever
 * follows the prefix).
 */
export interface RouteMapping {
  /** e.g. `'apps/checkout/app/'` — matched as a plain string prefix against changed paths. */
  pathPrefix: string;
  /** e.g. `'/checkout/*'` — `*` is substituted with the path remainder after `pathPrefix`. */
  urlPattern: string;
}

/** Result of {@link resolveChangedRoutes}. */
export interface ResolveChangedRoutesResult {
  /** Resolved, deduped, absolute route URLs — capped at `maxRoutes`. */
  routes: string[];
  /** How many additional matched routes were dropped by the `maxRoutes` cap. */
  skippedCount: number;
}

function substitute(urlPattern: string, remainder: string): string {
  return urlPattern.includes('*') ? urlPattern.replaceAll('*', () => remainder) : urlPattern;
}

function resolveAgainstBase(path: string, baseUrl: string): string {
  return new URL(path, baseUrl).toString();
}

/**
 * Pure function: matches each changed file/module in `surface` against `mappings` by prefix,
 * substitutes the remainder into `urlPattern`, resolves against `baseUrl`, and dedupes. Returns
 * at most `maxRoutes` URLs (stable order: first-matched-first); anything beyond that is dropped,
 * not silently truncated — `skippedCount` tells the caller how much was left undone.
 */
export function resolveChangedRoutes(
  surface: ChangeSurface,
  mappings: RouteMapping[],
  baseUrl: string,
  maxRoutes: number,
): ResolveChangedRoutesResult {
  const candidates = [...surface.changedFiles, ...surface.changedModules];
  const seen = new Set<string>();
  const matched: string[] = [];

  for (const candidate of candidates) {
    for (const mapping of mappings) {
      if (!candidate.startsWith(mapping.pathPrefix)) continue;
      const remainder = candidate.slice(mapping.pathPrefix.length);
      const url = resolveAgainstBase(substitute(mapping.urlPattern, remainder), baseUrl);
      if (seen.has(url)) continue;
      seen.add(url);
      matched.push(url);
    }
  }

  const routes = matched.slice(0, maxRoutes);
  const skippedCount = matched.length - routes.length;
  return { routes, skippedCount };
}
