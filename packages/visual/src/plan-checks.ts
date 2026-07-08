import type { ChangeSurface, PlanVisualChecks, VisualCheck, WardenConfig } from '@warden/core';

/**
 * Expands the touched modules into the `module × viewport × theme` capture matrix.
 *
 * Only modules named in `changeSurface.changedModules` are planned (visual runs on what the PR
 * touched, never the whole app), the global `visual.mask` is attached to every check, and the
 * matrix is capped at `visual.maxChecks` — overflow is dropped here and reported upstream. When
 * `visual.enabled` is false the matrix is empty, so the pipeline no-ops at zero cost.
 */
export const planVisualChecks: PlanVisualChecks = (
  changeSurface: ChangeSurface,
  cfg: WardenConfig,
  resolveUrl: (module: string) => string,
): VisualCheck[] => {
  if (!cfg.visual.enabled) return [];

  const modules = [...new Set(changeSurface.changedModules)].filter((m) => m.length > 0);
  const { viewports, themes, mask, maxChecks } = cfg.visual;

  const checks: VisualCheck[] = [];
  for (const module of modules) {
    const url = resolveUrl(module);
    for (const viewport of viewports) {
      for (const theme of themes) {
        if (checks.length >= maxChecks) return checks;
        checks.push({
          module,
          url,
          viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
          theme,
          ...(mask.length > 0 && { mask: [...mask] }),
        });
      }
    }
  }

  return checks;
};

/** Total size of the uncapped matrix, so callers can report how many checks were skipped. */
export function plannedMatrixSize(changeSurface: ChangeSurface, cfg: WardenConfig): number {
  if (!cfg.visual.enabled) return 0;
  const modules = [...new Set(changeSurface.changedModules)].filter((m) => m.length > 0);
  return modules.length * cfg.visual.viewports.length * cfg.visual.themes.length;
}
