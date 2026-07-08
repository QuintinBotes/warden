import { describe, expect, it } from 'vitest';
import { defineConfig, type VisualJudge, type WardenConfigInput } from '@warden/core';
import { compareCheck, keyOf } from './compare.js';
import { ProviderVisualJudge } from './provider-visual-judge.js';
import {
  fakeBaselineStore,
  fakeVisionProvider,
  fakeVisualEngine,
  fixtureCheck,
  fixtureShot,
  memArtifactSink,
} from './testing-fakes.js';

const cfg = (visual: NonNullable<WardenConfigInput['visual']> = {}) =>
  defineConfig({
    visual: {
      enabled: true,
      viewports: [{ name: 'desktop', width: 8, height: 8 }],
      themes: ['light'],
      ...visual,
    },
  });

const changedShot = (check = fixtureCheck()) =>
  fixtureShot({ check, patch: { x: 0, y: 0, w: 4, h: 2, color: [0, 0, 0, 255] } });

describe('compareCheck', () => {
  it('returns MATCH when the render equals the committed baseline', async () => {
    const check = fixtureCheck();
    const store = fakeBaselineStore();
    store.seed(keyOf(check), fixtureShot({ check }));

    const result = await compareCheck({
      check,
      engine: fakeVisualEngine(),
      store,
      cfg: cfg(),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
    });

    expect(result.status).toBe('MATCH');
    expect(result.changedRatio).toBe(0);
    expect(result.candidatePath).toContain('candidate.png');
  });

  it('returns NEW_BASELINE and writes a pending baseline when none exists', async () => {
    const store = fakeBaselineStore();

    const result = await compareCheck({
      check: fixtureCheck(),
      engine: fakeVisualEngine(),
      store,
      cfg: cfg(),
      sourceSha: 'sha-1',
      artifacts: memArtifactSink(),
    });

    expect(result.status).toBe('NEW_BASELINE');
    expect(store.putPendingCalls).toHaveLength(1);
    expect(store.putPendingCalls[0]!.sourceSha).toBe('sha-1');
  });

  it('returns VISUAL_DIFF in pixel mode when the render differs beyond the noise floor', async () => {
    const check = fixtureCheck();
    const store = fakeBaselineStore();
    store.seed(keyOf(check), fixtureShot({ check }));

    const result = await compareCheck({
      check,
      engine: fakeVisualEngine(changedShot),
      store,
      cfg: cfg({ mode: 'pixel' }),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
    });

    expect(result.status).toBe('VISUAL_DIFF');
    expect(result.changedRatio).toBeGreaterThan(0);
    expect(result.diffPath).toContain('diff.png');
  });

  it('downgrades a render-noise verdict to MATCH in AI mode', async () => {
    const check = fixtureCheck();
    const store = fakeBaselineStore();
    store.seed(keyOf(check), fixtureShot({ check }));

    const result = await compareCheck({
      check,
      engine: fakeVisualEngine(changedShot),
      store,
      cfg: cfg({ mode: 'ai' }),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
      judge: new ProviderVisualJudge(fakeVisionProvider({ classification: 'render-noise' })),
    });

    expect(result.status).toBe('MATCH');
    expect(result.judgment?.classification).toBe('render-noise');
  });

  it('keeps VISUAL_DIFF for a meaningful verdict in AI mode', async () => {
    const check = fixtureCheck();
    const store = fakeBaselineStore();
    store.seed(keyOf(check), fixtureShot({ check }));

    const result = await compareCheck({
      check,
      engine: fakeVisualEngine(changedShot),
      store,
      cfg: cfg({ mode: 'ai' }),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
      judge: new ProviderVisualJudge(fakeVisionProvider({ classification: 'meaningful' })),
    });

    expect(result.status).toBe('VISUAL_DIFF');
    expect(result.judgment?.classification).toBe('meaningful');
  });

  it('falls back to the pixel verdict when the AI judge errors', async () => {
    const check = fixtureCheck();
    const store = fakeBaselineStore();
    store.seed(keyOf(check), fixtureShot({ check }));
    const throwingJudge: VisualJudge = {
      async judge() {
        throw new Error('judge timeout');
      },
    };

    const result = await compareCheck({
      check,
      engine: fakeVisualEngine(changedShot),
      store,
      cfg: cfg({ mode: 'ai' }),
      sourceSha: 'sha',
      artifacts: memArtifactSink(),
      judge: throwingJudge,
    });

    expect(result.status).toBe('VISUAL_DIFF');
    expect(result.judgment).toBeUndefined();
  });
});
