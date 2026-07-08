import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { resolveLinks } from './link-resolver.js';

describe('resolveLinks', () => {
  it('rewrites `self` to the source repo across test, doc, and dependent links', () => {
    const cfg = defineConfig({
      links: {
        testRepos: [
          { repo: 'self', pathPrefix: 'tests/', mapping: 'by-tag' },
          { repo: 'org/e2e', pathPrefix: 't/' },
        ],
        docRepos: [{ repo: 'self', pathPrefix: 'docs/' }],
        dependents: ['org/billing', 'self'],
      },
    });

    const links = resolveLinks('org/checkout', cfg);

    expect(links.testRepos[0]).toEqual({
      repo: 'org/checkout',
      pathPrefix: 'tests/',
      mapping: 'by-tag',
    });
    expect(links.testRepos[1]?.repo).toBe('org/e2e');
    expect(links.docRepos[0]?.repo).toBe('org/checkout');
    expect(links.dependents).toEqual(['org/billing', 'org/checkout']);
  });

  it('returns empty arrays when no links are configured', () => {
    const links = resolveLinks('org/checkout', defineConfig());

    expect(links.testRepos).toEqual([]);
    expect(links.docRepos).toEqual([]);
    expect(links.dependents).toEqual([]);
  });

  it('does not alias into cfg.links (pure)', () => {
    const cfg = defineConfig({
      links: { testRepos: [{ repo: 'org/e2e' }], docRepos: [], dependents: [] },
    });

    const links = resolveLinks('org/checkout', cfg);

    expect(links.testRepos).not.toBe(cfg.links.testRepos);
    expect(links.testRepos[0]).not.toBe(cfg.links.testRepos[0]);
  });
});
