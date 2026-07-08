import type { Cuj, ChangeSurface, TouchedCuj } from '@warden/core';

/**
 * The pure intersection of a change surface with a set of CUJs. This is what makes the CUJ gate
 * *scoped*: only journeys a change actually touches can gate it. A CUJ is touched when the union
 * of the change surface's `testTags` + `changedModules` intersects the union of the CUJ's own
 * `tags` and its steps' `module` tags.
 */
export function resolveTouchedCujs(surface: ChangeSurface, cujs: Cuj[]): TouchedCuj[] {
  const surfaceSet = new Set<string>([...surface.testTags, ...surface.changedModules]);
  const touched: TouchedCuj[] = [];

  for (const cuj of cujs) {
    const cujTags = new Set<string>(cuj.tags);
    for (const step of cuj.steps) {
      if (step.module) cujTags.add(step.module);
    }

    const matchedTags = [...cujTags].filter((tag) => surfaceSet.has(tag)).sort();
    if (matchedTags.length === 0) continue;

    touched.push({
      cuj,
      matchedTags,
      reason: `Change surface intersects journey '${cuj.name}' on: ${matchedTags.join(', ')}`,
    });
  }

  return touched;
}
