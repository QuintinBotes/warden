import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import type { TestCase } from '@warden/core';
import { runProactiveHeal } from './run.js';
import {
  fakeLocatingSession,
  fixturePr,
  memFileAccess,
  recordingGitHub,
  recordingHealMetrics,
  scriptedProvider,
} from './testing-fakes.js';

const spec = [
  "test('checkout', async ({ page }) => {",
  "  await page.getByRole('button', { name: 'Buy' }).click();",
  "  await page.getByLabel('Email').fill('a@b.com');",
  '});',
  '',
].join('\n');

function testCase(): TestCase {
  return {
    id: 'TC-1',
    title: 'checkout',
    type: 'regression',
    priority: 'P1',
    tags: [],
    requirementIds: [],
    automation: { framework: 'playwright', filePath: 'tests/e2e/checkout.spec.ts' },
    source: 'manual',
  };
}

function baseInput() {
  return {
    testCases: [testCase()],
    fileAccess: memFileAccess({ 'tests/e2e/checkout.spec.ts': spec }),
    provider: scriptedProvider([
      {
        toolCalls: [
          { name: 'propose_locator', input: { suggestedName: 'Purchase', confidence: 'high' } },
        ],
      },
    ]),
    gh: recordingGitHub(),
    metrics: recordingHealMetrics(),
    sourcePr: fixturePr(),
  };
}

const enabled = defineConfig({
  proactiveHealing: { enabled: true, previewUrlTemplate: 'https://preview/{pr}' },
});

describe('runProactiveHeal', () => {
  it('runs the full pipeline: extract → resolve → suggest → publish → emitHeal', async () => {
    const input = baseInput();
    // 'Buy' no longer resolves; 'Email' still does.
    const session = fakeLocatingSession({ locate: (_k, _r, name) => (name === 'Buy' ? 0 : 1) });

    const result = await runProactiveHeal({ ...input, session, cfg: enabled });

    expect(result.status).toBe('checked');
    expect(result.summary).toEqual({
      checked: 2,
      resolved: 1,
      missing: 1,
      ambiguous: 0,
      suggested: 1,
      healRate: 0.5,
    });

    // Draft healing PR opened on the idempotent branch, with the Buy→Purchase patch.
    expect(input.gh.draftPrCalls).toHaveLength(1);
    expect(input.gh.draftPrCalls[0]!.branch).toBe('warden/proactive-heal-pr-42');
    expect(input.gh.draftPrCalls[0]!.files[0]!.content).toContain("name: 'Purchase'");
    expect(result.draftPr).toBeDefined();

    // Always a neutral, informational check — never a gate input.
    expect(input.gh.checkRunCalls).toHaveLength(1);
    expect(input.gh.checkRunCalls[0]!.conclusion).toBe('neutral');

    // Heal metric emitted exactly once, in proactive mode, with the run's summary.
    expect(result.emittedHeal).toBe(true);
    expect(input.metrics.healCalls).toHaveLength(1);
    expect(input.metrics.healCalls[0]!.meta).toEqual({ pr: 42, mode: 'proactive' });
    expect(input.metrics.healCalls[0]!.summary).toEqual(result.summary);

    // Only the broken locator was sent to the provider.
    expect(input.provider.calls).toHaveLength(1);
  });

  it('posts a neutral "no preview URL" check and does not emit a metric when previewUrlTemplate is unset', async () => {
    const input = baseInput();
    const session = fakeLocatingSession({ locate: () => 1 });
    const cfg = defineConfig({ proactiveHealing: { enabled: true } });

    const result = await runProactiveHeal({ ...input, session, cfg });

    expect(result.status).toBe('no-preview');
    expect(input.gh.draftPrCalls).toHaveLength(0);
    expect(input.gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(input.gh.checkRunCalls[0]!.summary).toMatch(/No preview URL/);
    expect(result.emittedHeal).toBe(false);
    expect(input.metrics.healCalls).toHaveLength(0);
  });

  it('reports an unsupported engine (never a 100% heal rate) when the session has no locate()', async () => {
    const input = baseInput();
    const session = fakeLocatingSession(); // no locate

    const result = await runProactiveHeal({ ...input, session, cfg: enabled });

    expect(result.status).toBe('unsupported-engine');
    expect(input.gh.draftPrCalls).toHaveLength(0);
    expect(input.gh.checkRunCalls[0]!.conclusion).toBe('neutral');
    expect(input.gh.checkRunCalls[0]!.summary).toMatch(/unsupported for engine "playwright"/);
    expect(result.emittedHeal).toBe(false);
    expect(input.metrics.healCalls).toHaveLength(0);
  });
});
