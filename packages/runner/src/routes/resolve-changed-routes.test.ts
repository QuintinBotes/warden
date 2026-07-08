import { describe, expect, it } from 'vitest';
import { fixtureChangeSurface } from '@warden/core/testing';
import { resolveChangedRoutes, type RouteMapping } from './resolve-changed-routes';

const baseUrl = 'https://preview.example.com';

describe('resolveChangedRoutes', () => {
  it('resolves a changed file against a matching prefix, substituting the remainder', () => {
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/checkout/app/page.tsx'],
      changedModules: [],
    });
    const mappings: RouteMapping[] = [
      { pathPrefix: 'apps/checkout/app/', urlPattern: '/checkout/*' },
    ];

    const { routes, skippedCount } = resolveChangedRoutes(surface, mappings, baseUrl, 10);

    expect(routes).toEqual(['https://preview.example.com/checkout/page.tsx']);
    expect(skippedCount).toBe(0);
  });

  it('supports a urlPattern with no wildcard (fixed route)', () => {
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/checkout/app/page.tsx'],
      changedModules: [],
    });
    const mappings: RouteMapping[] = [
      { pathPrefix: 'apps/checkout/app/', urlPattern: '/checkout' },
    ];

    const { routes } = resolveChangedRoutes(surface, mappings, baseUrl, 10);

    expect(routes).toEqual(['https://preview.example.com/checkout']);
  });

  it('ignores changed files/modules that match no mapping', () => {
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/other/index.ts'],
      changedModules: ['apps/other'],
    });
    const mappings: RouteMapping[] = [
      { pathPrefix: 'apps/checkout/app/', urlPattern: '/checkout/*' },
    ];

    const { routes, skippedCount } = resolveChangedRoutes(surface, mappings, baseUrl, 10);

    expect(routes).toEqual([]);
    expect(skippedCount).toBe(0);
  });

  it('dedupes routes that resolve to the same URL', () => {
    const surface = fixtureChangeSurface({
      changedFiles: ['apps/checkout/app/page.tsx', 'apps/checkout/app/page.tsx'],
      changedModules: [],
    });
    const mappings: RouteMapping[] = [
      { pathPrefix: 'apps/checkout/app/', urlPattern: '/checkout/*' },
    ];

    const { routes } = resolveChangedRoutes(surface, mappings, baseUrl, 10);

    expect(routes).toHaveLength(1);
  });

  it('caps at maxRoutes and reports the skipped count instead of silently truncating', () => {
    const surface = fixtureChangeSurface({
      changedFiles: [
        'apps/checkout/app/a.tsx',
        'apps/checkout/app/b.tsx',
        'apps/checkout/app/c.tsx',
      ],
      changedModules: [],
    });
    const mappings: RouteMapping[] = [
      { pathPrefix: 'apps/checkout/app/', urlPattern: '/checkout/*' },
    ];

    const { routes, skippedCount } = resolveChangedRoutes(surface, mappings, baseUrl, 2);

    expect(routes).toHaveLength(2);
    expect(skippedCount).toBe(1);
  });

  it('matches changedModules as well as changedFiles', () => {
    const surface = fixtureChangeSurface({
      changedFiles: [],
      changedModules: ['apps/checkout/app/checkout-flow'],
    });
    const mappings: RouteMapping[] = [
      { pathPrefix: 'apps/checkout/app/', urlPattern: '/checkout/*' },
    ];

    const { routes } = resolveChangedRoutes(surface, mappings, baseUrl, 10);

    expect(routes).toEqual(['https://preview.example.com/checkout/checkout-flow']);
  });

  it('returns no routes and no skips when there are no mappings configured', () => {
    const surface = fixtureChangeSurface();
    const { routes, skippedCount } = resolveChangedRoutes(surface, [], baseUrl, 10);
    expect(routes).toEqual([]);
    expect(skippedCount).toBe(0);
  });
});
