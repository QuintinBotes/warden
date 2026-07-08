import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { shouldRunProactiveHeal } from './should-run-proactive-heal.js';

const on = defineConfig({ proactiveHealing: { enabled: true } });
const off = defineConfig({ proactiveHealing: { enabled: false } });

describe('shouldRunProactiveHeal', () => {
  it('is false when the feature is disabled, even with UI changes', () => {
    const surface = fixtureChangeSurface({ affectedComponents: ['apps/shop/Cart.tsx'] });
    expect(shouldRunProactiveHeal(surface, off)).toBe(false);
  });

  it('is true when enabled and affectedComponents is non-empty', () => {
    const surface = fixtureChangeSurface({ affectedComponents: ['apps/shop/Cart.tsx'] });
    expect(shouldRunProactiveHeal(surface, on)).toBe(true);
  });

  it('is false when enabled but there is no UI change', () => {
    const surface = fixtureChangeSurface({
      affectedComponents: [],
      changedModules: ['lib/auth'],
      changedFiles: ['lib/auth/token.ts'],
    });
    expect(shouldRunProactiveHeal(surface, on)).toBe(false);
  });

  it('is true when a changed file matches a uiPattern (default components/ pages/ app/)', () => {
    const surface = fixtureChangeSurface({
      affectedComponents: [],
      changedModules: ['apps/shop'],
      changedFiles: ['apps/shop/components/Button.ts'],
    });
    expect(shouldRunProactiveHeal(surface, on)).toBe(true);
  });

  it('honors a custom uiPatterns list', () => {
    const cfg = defineConfig({ proactiveHealing: { enabled: true, uiPatterns: ['ui/'] } });
    const matches = fixtureChangeSurface({
      affectedComponents: [],
      changedFiles: ['src/ui/widget.ts'],
    });
    const misses = fixtureChangeSurface({
      affectedComponents: [],
      changedModules: ['apps/shop'],
      changedFiles: ['src/components/widget.ts'],
    });
    expect(shouldRunProactiveHeal(matches, cfg)).toBe(true);
    expect(shouldRunProactiveHeal(misses, cfg)).toBe(false);
  });
});
