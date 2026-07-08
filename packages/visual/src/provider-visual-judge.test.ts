import { describe, expect, it } from 'vitest';
import { ProviderError, type PixelDiffResult } from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import { ProviderVisualJudge } from './provider-visual-judge.js';
import { fakeVisionProvider, fixtureCheck } from './testing-fakes.js';

const pixel: PixelDiffResult = {
  changedRatio: 0.12,
  diffPng: new Uint8Array([1, 2, 3]),
  boundingBoxes: [{ x: 0, y: 0, w: 2, h: 2 }],
};

const input = {
  check: fixtureCheck(),
  baseline: new Uint8Array([9, 9]),
  candidate: new Uint8Array([8, 8]),
  pixel,
};

describe('ProviderVisualJudge', () => {
  it('parses a render-noise verdict and sends baseline + candidate images', async () => {
    const provider = fakeVisionProvider({
      classification: 'render-noise',
      confidence: 0.7,
      rationale: 'AA only',
    });
    const judge = new ProviderVisualJudge(provider);

    const verdict = await judge.judge(input);

    expect(verdict.classification).toBe('render-noise');
    expect(verdict.confidence).toBe(0.7);
    expect(verdict.rationale).toBe('AA only');
    expect(provider.imageCalls).toHaveLength(1);
    expect(provider.imageCalls[0]!.images).toHaveLength(2);
  });

  it('tolerates code fences and surrounding prose', async () => {
    const raw =
      'Here is my verdict:\n```json\n{"classification":"meaningful","confidence":0.95,"rationale":"button moved"}\n```';
    const judge = new ProviderVisualJudge(fakeVisionProvider({ raw }));

    const verdict = await judge.judge(input);

    expect(verdict.classification).toBe('meaningful');
    expect(verdict.rationale).toBe('button moved');
  });

  it('defaults to meaningful when the reply is unparseable (pixel floor wins)', async () => {
    const judge = new ProviderVisualJudge(fakeVisionProvider({ raw: 'no json here' }));

    const verdict = await judge.judge(input);

    expect(verdict.classification).toBe('meaningful');
  });

  it('throws when the provider has no generateWithImages', async () => {
    const judge = new ProviderVisualJudge(fakeProvider());

    await expect(judge.judge(input)).rejects.toBeInstanceOf(ProviderError);
  });
});
