import { describe, expect, it } from 'vitest';
import { defineConfig, type WardenConfig } from '@warden/core';
import {
  browserSdkSource,
  reverseProxySource,
  type CapturedSessionInput,
} from './traffic-source.js';

function cfg(overrides: Record<string, unknown> = {}): WardenConfig {
  return defineConfig({
    traffic: { enabled: true, sampleRate: 1, ...overrides },
  });
}

const consenting: CapturedSessionInput = {
  anonId: 'a1',
  url: 'https://shop.test/checkout/1001',
  startedAt: '2026-07-08T10:00:00.000Z',
  steps: [{ action: 'goto' }],
  consent: { granted: true, source: 'cookie' },
};
const nonConsenting: CapturedSessionInput = {
  ...consenting,
  anonId: 'a2',
  consent: { granted: false },
};
const dntSession: CapturedSessionInput = {
  ...consenting,
  anonId: 'a3',
  doNotTrack: true,
};

describe('browserSdkSource', () => {
  it('emits only consenting, non-DNT captures as RawTrafficSessions', async () => {
    const source = browserSdkSource({
      cfg: cfg(),
      random: () => 0, // always within sampleRate
      pull: async () => [consenting, nonConsenting, dntSession],
    });
    const out = await source.collect({ max: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.anonId).toBe('a1');
    expect(out[0]!.consent.granted).toBe(true);
    expect(out[0]!.startedAt).toBeInstanceOf(Date);
  });

  it('honors the sampleRate deterministically', async () => {
    const half = cfg({ sampleRate: 0.5 });
    const dropped = await browserSdkSource({
      cfg: half,
      random: () => 0.9, // 0.9 >= 0.5 → dropped
      pull: async () => [consenting],
    }).collect({ max: 10 });
    expect(dropped).toHaveLength(0);

    const kept = await browserSdkSource({
      cfg: half,
      random: () => 0.1, // 0.1 < 0.5 → kept
      pull: async () => [consenting],
    }).collect({ max: 10 });
    expect(kept).toHaveLength(1);
  });

  it('bounds output by max', async () => {
    const source = browserSdkSource({
      cfg: cfg(),
      random: () => 0,
      pull: async () => [consenting, { ...consenting, anonId: 'a4' }],
    });
    expect(await source.collect({ max: 1 })).toHaveLength(1);
  });
});

describe('reverseProxySource', () => {
  it('applies the same consent gate to reconstructed sessions', async () => {
    const proxyEntry: CapturedSessionInput = { ...consenting, consent: { granted: true } };
    const source = reverseProxySource({
      cfg: cfg(),
      random: () => 0,
      readSessions: async () => [proxyEntry, nonConsenting],
    });
    const out = await source.collect({ max: 10 });
    expect(out).toHaveLength(1);
    expect(out[0]!.consent.source).toBe('header'); // proxy default consent source when unset
  });
});
