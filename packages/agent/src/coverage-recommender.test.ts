import { describe, it, expect } from 'vitest';
import { defineConfig, type Recommendation } from '@warden/core';
import { fakeProvider, fixtureChangeSurface } from '@warden/core/testing';
import { createCoverageRecommender, type CoverageGapInput } from './coverage-recommender';

const config = defineConfig();

/** A canned spec WITHOUT a Playwright tag, so the recommender must add one. */
const CANNED_SPEC = `import { test, expect } from '@playwright/test';

test('checkout happy path', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
});
`;

/** One gap of every (kind x type) combination the analyzer can emit. */
function mixedGaps(): CoverageGapInput[] {
  return [
    {
      kind: 'test',
      type: 'uncovered',
      subject: 'POST /api/checkout',
      detail: 'New checkout route has no covering spec.',
      relatedPath: 'src/routes/checkout.ts',
      targetRepo: 'org/e2e-tests',
    },
    {
      kind: 'test',
      type: 'changed',
      subject: 'checkout total',
      detail: 'Spec still asserts the pre-tax total.',
      relatedPath: 'org/e2e-tests:tests/e2e/checkout.spec.ts',
    },
    {
      kind: 'test',
      type: 'orphaned',
      subject: 'legacy coupon flow',
      detail: 'Feature was deleted; its test is dead.',
      relatedPath: 'tests/e2e/coupon.spec.ts',
    },
    {
      kind: 'doc',
      type: 'uncovered',
      subject: 'X-Idempotency-Key header',
      detail: 'New header is undocumented.',
      relatedPath: 'docs/api/checkout.md',
      targetRepo: 'org/developer-portal',
    },
    {
      kind: 'doc',
      type: 'changed',
      subject: 'checkout response shape',
      detail: 'Docs describe the old response body.',
      relatedPath: 'self:docs/api/checkout.md',
    },
    {
      kind: 'doc',
      type: 'orphaned',
      subject: 'coupon endpoint',
      detail: 'Endpoint removed but still documented.',
      relatedPath: 'docs/api/coupon.md',
    },
  ];
}

describe('createCoverageRecommender', () => {
  it('returns a recommender with a recommend method', () => {
    const recommender = createCoverageRecommender();
    expect(typeof recommender.recommend).toBe('function');
  });

  it('returns no recommendations and does not call the provider for zero gaps', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: [],
      provider,
      cfg: config,
    });
    expect(recs).toEqual([]);
    expect(provider.calls).toHaveLength(0);
  });

  it('produces exactly one recommendation per gap, in order, each with a reason', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const gaps = mixedGaps();
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps,
      provider,
      cfg: config,
    });

    expect(recs).toHaveLength(gaps.length);
    recs.forEach((rec, i) => {
      expect(rec.kind).toBe(gaps[i]!.kind);
      expect(rec.reason.trim().length).toBeGreaterThan(0);
    });
    // provider was consulted once per gap
    expect(provider.calls.filter((c) => c.method === 'generateText')).toHaveLength(gaps.length);
  });

  it('maps gap type to action and add=>content, update/remove=>patch', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: mixedGaps(),
      provider,
      cfg: config,
    });

    const expectAction: Record<string, Recommendation['action']> = {
      uncovered: 'add',
      changed: 'update',
      orphaned: 'remove',
    };
    const gaps = mixedGaps();
    recs.forEach((rec, i) => {
      const gap = gaps[i]!;
      expect(rec.action).toBe(expectAction[gap.type]);
      if (rec.action === 'add') {
        expect(rec.content).toBeDefined();
        expect(rec.content!.length).toBeGreaterThan(0);
        expect(rec.patch).toBeUndefined();
      } else {
        expect(rec.patch).toBeDefined();
        expect(rec.patch!.length).toBeGreaterThan(0);
        expect(rec.content).toBeUndefined();
      }
    });
  });

  it('emits a tagged Playwright spec for a test-add even when the model output has no tag', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: [mixedGaps()[0]!],
      provider,
      cfg: config,
    });
    const rec = recs[0]!;
    expect(rec.kind).toBe('test');
    expect(rec.action).toBe('add');
    expect(rec.content).toMatch(/@smoke|@regression/);
    expect(rec.content).toContain('@playwright/test');
    expect(rec.path).toMatch(/\.spec\.ts$/);
  });

  it('uses the model output verbatim as markdown for a doc-add', async () => {
    const markdown = '## X-Idempotency-Key\n\nSend this header to make checkout idempotent.\n';
    const provider = fakeProvider({ text: markdown });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: [mixedGaps()[3]!],
      provider,
      cfg: config,
    });
    const rec = recs[0]!;
    expect(rec.kind).toBe('doc');
    expect(rec.action).toBe('add');
    expect(rec.content).toContain('X-Idempotency-Key');
    expect(rec.path).toMatch(/\.md$/);
  });

  it('passes through an explicit gap targetRepo and defaults to self otherwise', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const gaps: CoverageGapInput[] = [
      {
        kind: 'test',
        type: 'uncovered',
        subject: 'a',
        detail: 'b',
        relatedPath: 'tests/e2e/a.spec.ts',
        targetRepo: 'org/e2e-tests',
      },
      {
        kind: 'doc',
        type: 'changed',
        subject: 'c',
        detail: 'd',
        relatedPath: 'docs/c.md',
      },
    ];
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps,
      provider,
      cfg: config,
    });
    expect(recs[0]!.targetRepo).toBe('org/e2e-tests');
    expect(recs[1]!.targetRepo).toBe('self');
  });

  it('derives targetRepo and path from a repo-qualified relatedPath', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: [
        {
          kind: 'test',
          type: 'changed',
          subject: 'checkout total',
          detail: 'stale',
          relatedPath: 'org/e2e-tests:tests/e2e/checkout.spec.ts',
        },
      ],
      provider,
      cfg: config,
    });
    expect(recs[0]!.targetRepo).toBe('org/e2e-tests');
    expect(recs[0]!.path).toBe('tests/e2e/checkout.spec.ts');
  });

  it('carries requirementIds from the change surface and the gap', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const changeSurface = { ...fixtureChangeSurface(), requirementIds: ['REQ-1'] };
    const gaps: CoverageGapInput[] = [
      {
        kind: 'test',
        type: 'uncovered',
        subject: 'a',
        detail: 'b',
        relatedPath: 'src/a.ts',
        requirementIds: ['REQ-2'],
      },
    ];
    const recs = await createCoverageRecommender().recommend({
      changeSurface,
      diff: [],
      gaps,
      provider,
      cfg: config,
    });
    expect(recs[0]!.requirementIds).toEqual(expect.arrayContaining(['REQ-1', 'REQ-2']));
  });

  it('omits requirementIds when none are present', async () => {
    const provider = fakeProvider({ text: CANNED_SPEC });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: [mixedGaps()[2]!],
      provider,
      cfg: config,
    });
    expect(recs[0]!.requirementIds).toBeUndefined();
  });

  it('uses a model-provided unified diff verbatim for an update patch', async () => {
    const diff = `--- a/tests/e2e/checkout.spec.ts
+++ b/tests/e2e/checkout.spec.ts
@@ -3,1 +3,1 @@
-  await expect(total).toHaveText('100');
+  await expect(total).toHaveText('110');
`;
    const provider = fakeProvider({ text: diff });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: [mixedGaps()[1]!],
      provider,
      cfg: config,
    });
    expect(recs[0]!.action).toBe('update');
    expect(recs[0]!.patch).toBe(diff);
  });

  it('derives a robust patch when the model returns a non-diff canned string', async () => {
    const provider = fakeProvider({ text: 'assert the new total instead' });
    const recs = await createCoverageRecommender().recommend({
      changeSurface: fixtureChangeSurface(),
      diff: [],
      gaps: [mixedGaps()[1]!, mixedGaps()[2]!],
      provider,
      cfg: config,
    });
    // update
    expect(recs[0]!.patch).toMatch(/^--- a\//m);
    expect(recs[0]!.patch).toMatch(/^\+\+\+ /m);
    // remove is a deletion diff to /dev/null
    expect(recs[1]!.patch).toContain('/dev/null');
  });
});
