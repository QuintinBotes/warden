import { describe, expect, it } from 'vitest';
import { defineConfig, type WardenConfig } from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import { runTraffic, type RunTrafficInput } from './run.js';
import { defaultPiiScrubber } from './pii-scrubber.js';
import { createJourneyClusterer } from './journey-clusterer.js';
import { createCujProposer } from './cuj-proposer.js';
import {
  ALL_PII,
  PII,
  fakeTestSynthesizer,
  fakeTrafficSource,
  inMemoryTrafficStore,
  recordingGitHub,
  recordingTrafficMetrics,
  type FakeSourceEntry,
} from './testing-fakes.js';

const TARGET = { repo: 'acme/shop', branch: 'warden/traffic-proposals' };

/** 12 consenting checkout sessions carrying PII, 2 non-consenting, 1 Do-Not-Track. */
function entries(): FakeSourceEntry[] {
  const consenting: FakeSourceEntry[] = Array.from({ length: 12 }, (_, i) => ({
    anonId: `a${i}`,
    url: `https://shop.test/checkout/${1000 + i}`,
    startedAt: '2026-07-08T10:00:00.000Z',
    steps: [
      { action: 'goto', value: `https://shop.test/checkout/${1000 + i}` },
      { action: 'fill', selector: 'Email', value: PII.email },
      { action: 'click', selector: 'Checkout' },
    ],
    routeTemplate: '/checkout/:id',
    consent: { granted: true, source: 'cookie' },
  }));
  const nonConsenting: FakeSourceEntry[] = [
    { ...consenting[0]!, anonId: 'n1', consent: { granted: false } },
    { ...consenting[1]!, anonId: 'n2', consent: { granted: false } },
  ];
  const dnt: FakeSourceEntry[] = [{ ...consenting[2]!, anonId: 'd1', doNotTrack: true }];
  return [...consenting, ...nonConsenting, ...dnt];
}

function wire(cfg: WardenConfig, source = fakeTrafficSource(entries())) {
  const store = inMemoryTrafficStore();
  const gh = recordingGitHub();
  const metrics = recordingTrafficMetrics();
  const input: RunTrafficInput = {
    cfg,
    source,
    store,
    scrubber: defaultPiiScrubber({ redactionToken: cfg.traffic.pii.redactionToken }),
    clusterer: createJourneyClusterer({
      minSessions: cfg.traffic.clustering.minSessions,
      businessWeightByRoute: cfg.traffic.clustering.businessWeightByRoute,
      redactionToken: cfg.traffic.pii.redactionToken,
    }),
    synthesizer: fakeTestSynthesizer(),
    cujProposer: createCujProposer(),
    provider: fakeProvider({ text: 'Guest Checkout' }),
    gh,
    metrics,
    target: TARGET,
  };
  return { input, store, gh, metrics };
}

function baseCfg(over: Record<string, unknown> = {}): WardenConfig {
  return defineConfig({
    traffic: {
      enabled: true,
      sampleRate: 1,
      clustering: {
        minSessions: 3,
        topClusters: 20,
        businessWeightByRoute: { '/checkout/:id': 5 },
      },
      synthesis: { minClusterFrequency: 5, proposeCujs: true, outDir: 'tests/e2e/traffic/' },
      ...over,
    },
  });
}

describe('runTraffic', () => {
  it('returns disabled and opens no PR when the feature is off', async () => {
    const { input, gh, metrics } = wire(defineConfig({}));
    const summary = await runTraffic(input);
    expect(summary.status).toBe('disabled');
    expect(gh.draftPrCalls).toHaveLength(0);
    expect(metrics.runs).toHaveLength(0);
  });

  it('never ingests non-consenting or DNT traffic', async () => {
    const { input, store } = wire(baseCfg());
    const summary = await runTraffic(input);
    expect(summary.ingested).toBe(12); // only the consenting sessions
    expect(store.puts).toHaveLength(12);
  });

  it('stores only scrubbed sessions — no raw envelope, no raw PII anywhere', async () => {
    const { input, store, gh } = wire(baseCfg());
    const summary = await runTraffic(input);

    // No raw session envelope was persisted.
    for (const put of store.puts) {
      expect((put as { anonId?: string }).anonId).toBeUndefined();
      expect((put as { consent?: unknown }).consent).toBeUndefined();
    }
    // The load-bearing property: no raw PII in any stored session, cluster, spec, or PR payload.
    const everywhere = JSON.stringify({
      summary,
      puts: store.puts,
      draftPrCalls: gh.draftPrCalls,
    });
    for (const pii of ALL_PII) expect(everywhere).not.toContain(pii);
    expect(summary.redactions).toBeGreaterThan(0);
  });

  it('publishes a single idempotent draft PR with the synthesized specs and a CUJ summary', async () => {
    const { input, gh } = wire(baseCfg());
    const summary = await runTraffic(input);

    expect(summary.status).toBe('proposed');
    expect(summary.draftPr).toEqual({ url: expect.any(String), number: expect.any(Number) });
    expect(gh.draftPrCalls).toHaveLength(1);

    const call = gh.draftPrCalls[0]!;
    expect(call.repo).toBe('acme/shop');
    expect(call.branch).toBe('warden/traffic-proposals'); // stable branch → idempotent
    expect(call.files).toHaveLength(summary.specs.length);
    expect(call.files.map((f) => f.path)).toEqual(summary.specs.map((s) => s.path));
    expect(call.body).toContain('Candidate Critical User Journeys');
  });

  it('synthesizes @traffic-tagged specs pathed under the configured outDir', async () => {
    const { input } = wire(baseCfg());
    const summary = await runTraffic(input);

    expect(summary.specs.length).toBeGreaterThan(0);
    for (const spec of summary.specs) {
      expect(spec.path.startsWith('tests/e2e/traffic/')).toBe(true);
      expect(spec.tags).toContain('@traffic');
      expect(spec.tags).toContain('@route:/checkout/:id');
      expect(spec.content).toContain('@traffic');
    }
  });

  it('proposes a candidate CUJ per synthesized cluster, linked to its specs', async () => {
    const { input } = wire(baseCfg());
    const summary = await runTraffic(input);

    expect(summary.candidateCujs).toHaveLength(1);
    const cuj = summary.candidateCujs[0]!;
    expect(cuj.name).toBe('Guest Checkout');
    expect(cuj.routeTemplate).toBe('/checkout/:id');
    expect(cuj.frequency).toBe(12);
    expect(cuj.testPaths).toEqual(summary.specs.map((s) => s.path));
  });

  it('records ingest / scrub / cluster / spec counts to the metrics sink', async () => {
    const { input, metrics } = wire(baseCfg());
    await runTraffic(input);
    expect(metrics.runs).toHaveLength(1);
    const run = metrics.runs[0]!;
    expect(run.ingested).toBe(12);
    expect(run.redactions).toBeGreaterThan(0);
    expect(run.clusters).toBe(1);
    expect(run.specs).toBeGreaterThan(0);
    expect(run.candidateCujs).toBe(1);
  });

  it('opens no PR when nothing clears the frequency threshold (below-threshold)', async () => {
    const { input, gh, metrics } = wire(baseCfg({ synthesis: { minClusterFrequency: 100 } }));
    const summary = await runTraffic(input);
    expect(summary.status).toBe('below-threshold');
    expect(summary.clusters.length).toBeGreaterThan(0); // clustered, just not synthesized
    expect(summary.specs).toHaveLength(0);
    expect(gh.draftPrCalls).toHaveLength(0);
    expect(metrics.runs).toHaveLength(1); // counts still recorded
  });

  it('returns no-consent-traffic and opens no PR when no consenting sessions arrive', async () => {
    const noConsent = fakeTrafficSource([
      {
        anonId: 'x',
        url: 'https://shop.test/',
        startedAt: '2026-07-08T10:00:00.000Z',
        steps: [],
        consent: { granted: false },
      },
    ]);
    const { input, gh } = wire(baseCfg(), noConsent);
    const summary = await runTraffic(input);
    expect(summary.status).toBe('no-consent-traffic');
    expect(summary.ingested).toBe(0);
    expect(gh.draftPrCalls).toHaveLength(0);
  });
});
