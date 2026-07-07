import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import type { DiffFile } from '@warden/core';
import { computeChangeSurface, scoreRisk } from './index';

const cfg = defineConfig();

function file(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status };
}

describe('computeChangeSurface', () => {
  it('derives changed modules and test tags from apps/ paths', () => {
    const surface = computeChangeSurface([file('apps/checkout/page.tsx')], cfg);
    expect(surface.changedFiles).toEqual(['apps/checkout/page.tsx']);
    expect(surface.changedModules).toEqual(['apps/checkout']);
    expect(surface.testTags).toEqual(['@apps/checkout']);
    expect(surface.hasSharedChanges).toBe(false);
    expect(surface.affectedComponents).toEqual([]);
  });

  it('uses the first two segments for src/features paths', () => {
    const surface = computeChangeSurface([file('src/features/auth/login.ts')], cfg);
    expect(surface.changedModules).toEqual(['src/features']);
    expect(surface.testTags).toEqual(['@src/features']);
  });

  it('dedupes modules when multiple files share a module', () => {
    const surface = computeChangeSurface(
      [file('apps/checkout/page.tsx'), file('apps/checkout/form.tsx')],
      cfg,
    );
    expect(surface.changedModules).toEqual(['apps/checkout']);
  });

  it('ignores files that do not live under apps/ or src/features/', () => {
    const surface = computeChangeSurface([file('lib/util.ts')], cfg);
    expect(surface.changedModules).toEqual([]);
    expect(surface.testTags).toEqual([]);
  });

  it('flags shared changes when a path is under a configured shared path', () => {
    const surface = computeChangeSurface([file('lib/util.ts')], cfg);
    expect(surface.hasSharedChanges).toBe(true);
  });

  it('flags shared changes for any *.config.ts file', () => {
    const surface = computeChangeSurface([file('vitest.config.ts')], cfg);
    expect(surface.hasSharedChanges).toBe(true);
  });

  it('collects affected api routes', () => {
    const surface = computeChangeSurface([file('apps/api/users/route.ts', 'added')], cfg);
    expect(surface.affectedApiRoutes).toContain('apps/api/users/route.ts');
  });

  it('honors a custom tag prefix', () => {
    const custom = defineConfig({ scope: { tagPrefix: 'tag:' } });
    const surface = computeChangeSurface([file('apps/checkout/page.tsx')], custom);
    expect(surface.testTags).toEqual(['tag:apps/checkout']);
  });

  it('populates riskScore and riskReasons from scoreRisk', () => {
    const files = [file('apps/checkout/page.tsx')];
    const surface = computeChangeSurface(files, cfg);
    const risk = scoreRisk(files, cfg);
    expect(surface.riskScore).toBe(risk.score);
    expect(surface.riskReasons).toEqual(risk.reasons);
  });
});
