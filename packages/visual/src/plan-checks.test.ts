import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { planVisualChecks, plannedMatrixSize } from './plan-checks.js';

const resolveUrl = (module: string): string => `https://preview.test/${module}`;

describe('planVisualChecks', () => {
  it('returns nothing when visual is disabled', () => {
    const cfg = defineConfig({ visual: { enabled: false } });
    const surface = fixtureChangeSurface({ changedModules: ['apps/checkout'] });

    expect(planVisualChecks(surface, cfg, resolveUrl)).toEqual([]);
  });

  it('expands only touched modules across viewport × theme', () => {
    const cfg = defineConfig({
      visual: {
        enabled: true,
        viewports: [
          { name: 'desktop', width: 1280, height: 720 },
          { name: 'mobile', width: 375, height: 667 },
        ],
        themes: ['light', 'dark'],
      },
    });
    const surface = fixtureChangeSurface({ changedModules: ['apps/checkout'] });

    const checks = planVisualChecks(surface, cfg, resolveUrl);

    expect(checks).toHaveLength(4);
    expect(new Set(checks.map((c) => c.module))).toEqual(new Set(['apps/checkout']));
    expect(new Set(checks.map((c) => `${c.viewport.name}-${c.theme}`))).toEqual(
      new Set(['desktop-light', 'desktop-dark', 'mobile-light', 'mobile-dark']),
    );
    expect(checks[0]!.url).toBe('https://preview.test/apps/checkout');
  });

  it('attaches the global mask to every check', () => {
    const cfg = defineConfig({
      visual: {
        enabled: true,
        viewports: [{ name: 'desktop', width: 1280, height: 720 }],
        themes: ['light'],
        mask: ['.clock', '.avatar'],
      },
    });
    const surface = fixtureChangeSurface({ changedModules: ['apps/checkout'] });

    const [check] = planVisualChecks(surface, cfg, resolveUrl);

    expect(check!.mask).toEqual(['.clock', '.avatar']);
  });

  it('caps the matrix at maxChecks and reports the uncapped size', () => {
    const cfg = defineConfig({
      visual: {
        enabled: true,
        viewports: [
          { name: 'desktop', width: 1280, height: 720 },
          { name: 'mobile', width: 375, height: 667 },
        ],
        themes: ['light', 'dark'],
        maxChecks: 3,
      },
    });
    const surface = fixtureChangeSurface({ changedModules: ['apps/a', 'apps/b'] });

    const checks = planVisualChecks(surface, cfg, resolveUrl);

    expect(checks).toHaveLength(3);
    expect(plannedMatrixSize(surface, cfg)).toBe(8); // 2 modules × 2 viewports × 2 themes
  });
});
