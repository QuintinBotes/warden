import { describe, expect, it, vi } from 'vitest';
import type { TestCase } from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import type { FetchLike, FetchResponseLike } from '../fetch-like.js';
import { TestomatioAdapter } from './testomatio-adapter.js';
import { reconcileCatalog } from './catalog-merge.js';
import { sourceRefFromTestCase, withExternalId } from './id-convention.js';

function jsonResponse(body: unknown): FetchResponseLike {
  return { ok: true, status: 200, json: async () => body };
}

/**
 * Fully hermetic round-trip: pull the catalog, reconcile a `fakeProvider`-authored spec as
 * new-in-code, register it (upsert) to mint a stable id, write that id back into the spec's tags,
 * then push a result keyed by the same id — proving the id is the join key end to end.
 */
describe('TMS end-to-end (hermetic)', () => {
  it('registers a generated spec and attaches its result by stable id', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      // 1) pullCatalog
      .mockResolvedValueOnce(
        jsonResponse({
          tests: [
            {
              id: '@Texisting',
              title: 'Existing test',
              state: 'automated',
              file: 'a.spec.ts',
              test_name: 'a',
            },
          ],
        }),
      )
      // 2) upsertTest (create) mints the stable id
      .mockResolvedValueOnce(jsonResponse({ id: '@Tgen0001' }))
      // 3) pushResults reporter Run
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const adapter = new TestomatioAdapter({ token: 'k', project: 'p', fetchImpl });

    // A generative agent authors a spec title via the injected fake provider (no real LLM).
    const provider = fakeProvider({ text: 'Checkout supports gift cards' });
    const title = await provider.generateText('propose a test for the checkout diff');

    // The proposed spec, freshly written to the generated dir — no external id tag yet.
    let generated: TestCase = {
      id: 'TC-NEW',
      title,
      type: 'integration',
      priority: 'P2',
      tags: ['@checkout'],
      requirementIds: ['JIRA-100'],
      automation: { framework: 'playwright', filePath: 'checkout.spec.ts', testName: 'gift cards' },
      source: 'ai-generated',
    };

    // pull → merge: the proposed spec is new-in-code (no id yet).
    const catalog = await adapter.pullCatalog();
    const reconciliation = reconcileCatalog('testomatio', catalog, [generated]);
    expect(reconciliation.newInCode.map((e) => e.localCase?.id)).toEqual(['TC-NEW']);
    expect(reconciliation.matched.map((e) => e.externalId)).toEqual([]);

    // register: upsert the proposed spec, then carry the minted id back into the spec's tags.
    const ref = await adapter.upsertTest({
      title: generated.title,
      tags: generated.tags,
      requirementIds: generated.requirementIds,
      priority: generated.priority,
      source: generated.source,
      sourceRef: sourceRefFromTestCase(generated),
    });
    expect(ref.externalId).toBe('@Tgen0001');
    generated = withExternalId('testomatio', generated, ref.externalId);
    expect(generated.tags).toContain('@Tgen0001');

    // Re-running the merge now sees it as matched, not new-in-code (round-trip closed).
    const afterRegister = reconcileCatalog(
      'testomatio',
      [
        ...catalog,
        {
          externalId: ref.externalId,
          title: generated.title,
          tags: generated.tags,
          requirementIds: generated.requirementIds,
          automation: 'automated',
        },
      ],
      [generated],
    );
    expect(afterRegister.matched.map((e) => e.externalId)).toContain('@Tgen0001');
    expect(afterRegister.newInCode).toHaveLength(0);

    // push: the result attaches to the same stable id.
    await adapter.pushResults([{ externalId: ref.externalId, status: 'PASS', durationMs: 250 }], {
      runRef: 'PR-482',
      environment: 'preview',
      startedAt: new Date('2026-07-07T12:00:00Z'),
    });

    const reporterCall = fetchImpl.mock.calls[2]!;
    const payload = JSON.parse(reporterCall[1]?.body as string);
    expect(payload.tests[0].rid).toBe('@Tgen0001');
    expect(payload.tests[0].status).toBe('passed');
  });
});
