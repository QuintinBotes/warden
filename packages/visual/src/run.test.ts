import { describe, expect, it } from 'vitest';
import {
  defineConfig,
  type VisualBaselineKey,
  type VisualCheck,
  type WardenConfigInput,
} from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { runVisualChecks } from './run.js';
import { VISUAL_TOOL_NAME } from './to-ctrf.js';
import {
  fakeBaselineStore,
  fakeVisionProvider,
  fakeVisualEngine,
  fixtureShot,
  memArtifactSink,
} from './testing-fakes.js';

const resolveUrl = (module: string): string => `https://preview.test/${module}`;

const cfg = (visual: NonNullable<WardenConfigInput['visual']> = {}) =>
  defineConfig({
    visual: {
      enabled: true,
      viewports: [{ name: 'desktop', width: 8, height: 8 }],
      themes: ['light'],
      ...visual,
    },
  });

const checkoutKey: VisualBaselineKey = {
  module: 'apps/checkout',
  viewport: 'desktop',
  theme: 'light',
};
const changedShot = (check: VisualCheck) =>
  fixtureShot({ check, patch: { x: 0, y: 0, w: 4, h: 2, color: [0, 0, 0, 255] } });

describe('runVisualChecks', () => {
  it('no-ops at zero cost when visual is disabled', async () => {
    const engine = fakeVisualEngine();
    const result = await runVisualChecks({
      changeSurface: fixtureChangeSurface({ changedModules: ['apps/checkout'] }),
      cfg: defineConfig({ visual: { enabled: false } }),
      resolveUrl,
      engine,
      store: fakeBaselineStore(),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
    });

    expect(result.comparisons).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ctrf.results.tests).toEqual([]);
    expect(engine.captured).toEqual([]);
  });

  it('runs the full pipeline and closes the engine', async () => {
    const engine = fakeVisualEngine();
    const result = await runVisualChecks({
      changeSurface: fixtureChangeSurface({ changedModules: ['apps/checkout'] }),
      cfg: cfg(),
      resolveUrl,
      engine,
      store: fakeBaselineStore(),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
    });

    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0]!.status).toBe('NEW_BASELINE');
    expect(result.ctrf.results.tool.name).toBe(VISUAL_TOOL_NAME);
    expect(result.findings).toEqual([]);
    expect(engine.closed).toBe(1);
  });

  it('feeds the gate as BLOCK: a meaningful diff under gate: block is a CTRF failure', async () => {
    const store = fakeBaselineStore();
    store.seed(checkoutKey, fixtureShot());
    const result = await runVisualChecks({
      changeSurface: fixtureChangeSurface({ changedModules: ['apps/checkout'] }),
      cfg: cfg({ gate: 'block' }),
      resolveUrl,
      engine: fakeVisualEngine(changedShot),
      store,
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
    });

    expect(result.comparisons[0]!.status).toBe('VISUAL_DIFF');
    expect(result.ctrf.results.summary.failed).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.severity).toBe('HIGH');
  });

  it('feeds the gate as WARN: the same diff under gate: warn is a warn-tagged other', async () => {
    const store = fakeBaselineStore();
    store.seed(checkoutKey, fixtureShot());
    const result = await runVisualChecks({
      changeSurface: fixtureChangeSurface({ changedModules: ['apps/checkout'] }),
      cfg: cfg({ gate: 'warn' }),
      resolveUrl,
      engine: fakeVisualEngine(changedShot),
      store,
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
    });

    expect(result.ctrf.results.summary.failed).toBe(0);
    expect(result.ctrf.results.summary.other).toBe(1);
    expect(result.ctrf.results.tests[0]!.tags).toContain('warn');
  });

  it('downgrades render-noise to MATCH in AI mode via the provider judge', async () => {
    const store = fakeBaselineStore();
    store.seed(checkoutKey, fixtureShot());
    const result = await runVisualChecks({
      changeSurface: fixtureChangeSurface({ changedModules: ['apps/checkout'] }),
      cfg: cfg({ mode: 'ai', gate: 'block' }),
      resolveUrl,
      engine: fakeVisualEngine(changedShot),
      store,
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
      provider: fakeVisionProvider({ classification: 'render-noise' }),
    });

    expect(result.comparisons[0]!.status).toBe('MATCH');
    expect(result.ctrf.results.summary.failed).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('caps the matrix at maxChecks and reports the skipped count', async () => {
    const result = await runVisualChecks({
      changeSurface: fixtureChangeSurface({ changedModules: ['apps/a', 'apps/b'] }),
      cfg: cfg({
        viewports: [
          { name: 'desktop', width: 8, height: 8 },
          { name: 'mobile', width: 8, height: 8 },
        ],
        themes: ['light', 'dark'],
        maxChecks: 3,
      }),
      resolveUrl,
      engine: fakeVisualEngine(),
      store: fakeBaselineStore(),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
    });

    expect(result.comparisons).toHaveLength(3);
    expect(result.skipped).toBe(5);
  });
});
