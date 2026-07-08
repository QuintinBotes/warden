import { describe, it, expect } from 'vitest';
import { defineConfig } from './config';
import type { Recommendation, CoverageGap, RepoLinks } from './coverage-sync';

describe('links config (cross-repo coverage sync)', () => {
  it('defaults to empty links', () => {
    const cfg = defineConfig({});
    expect(cfg.links).toEqual({ testRepos: [], docRepos: [], dependents: [] });
  });

  it('fills per-link defaults and keeps declared links', () => {
    const cfg = defineConfig({
      links: {
        testRepos: [{ repo: 'org/e2e-tests', pathPrefix: 'tests/', mapping: 'by-tag' }],
        docRepos: [{ repo: 'self', pathPrefix: 'docs/' }],
        dependents: ['org/service-billing'],
      },
    });
    expect(cfg.links.testRepos[0]?.repo).toBe('org/e2e-tests');
    expect(cfg.links.docRepos[0]?.repo).toBe('self');
    expect(cfg.links.dependents).toEqual(['org/service-billing']);
  });
});

describe('coverage-sync types', () => {
  it('models a test-add and a doc-remove recommendation', () => {
    const recs: Recommendation[] = [
      {
        kind: 'test',
        action: 'add',
        targetRepo: 'org/e2e-tests',
        path: 'tests/e2e/guest-checkout.spec.ts',
        reason: 'New guest-checkout flow has no covering test',
        content: "import { test } from '@playwright/test';",
      },
      {
        kind: 'doc',
        action: 'remove',
        targetRepo: 'self',
        path: 'docs/legacy-coupon.md',
        reason: 'Coupon feature was removed in this PR',
        patch: '--- a/docs/legacy-coupon.md\n+++ /dev/null',
      },
    ];
    expect(recs.map((r) => `${r.kind}:${r.action}`)).toEqual(['test:add', 'doc:remove']);
  });

  it('models a coverage gap and repo links', () => {
    const gap: CoverageGap = {
      kind: 'test',
      type: 'uncovered',
      subject: 'POST /checkout/guest',
      detail: 'no test references this route',
    };
    const links: RepoLinks = { testRepos: [], docRepos: [], dependents: [] };
    expect(gap.type).toBe('uncovered');
    expect(links.testRepos).toEqual([]);
  });
});
