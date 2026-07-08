import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { createCollectorHandler } from './collector.js';
import { defaultPiiScrubber } from './pii-scrubber.js';
import { ALL_PII, inMemoryTrafficStore, piiLadenRawSession, rawSession } from './testing-fakes.js';

function handler(store = inMemoryTrafficStore(), enabled = true) {
  const cfg = defineConfig({ traffic: { enabled } });
  const scrubber = defaultPiiScrubber({ redactionToken: cfg.traffic.pii.redactionToken });
  return { h: createCollectorHandler({ cfg, store, scrubber }), store };
}

describe('createCollectorHandler', () => {
  it('scrubs before storing — no raw PII, and no raw envelope, is ever persisted', async () => {
    const { h, store } = handler();
    const res = await h({ method: 'POST', body: { sessions: [piiLadenRawSession()] } });

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(1);
    expect(store.puts).toHaveLength(1);
    const stored = JSON.stringify(store.puts);
    for (const pii of ALL_PII) expect(stored).not.toContain(pii);
    // stored session is a plain RecordedSession — the raw anonId/consent are gone.
    expect((store.puts[0] as { anonId?: string }).anonId).toBeUndefined();
  });

  it('refuses capture when traffic is disabled', async () => {
    const { h, store } = handler(inMemoryTrafficStore(), false);
    const res = await h({ method: 'POST', body: { sessions: [rawSession()] } });
    expect(res.status).toBe(404);
    expect(store.puts).toHaveLength(0);
  });

  it('suppresses capture on a Do-Not-Track header', async () => {
    const { h, store } = handler();
    const res = await h({
      method: 'POST',
      headers: { dnt: '1' },
      body: { sessions: [rawSession()] },
    });
    expect(res.body.status).toBe('suppressed-dnt');
    expect(store.puts).toHaveLength(0);
  });

  it('rejects non-consenting sessions', async () => {
    const { h, store } = handler();
    const nonConsenting = { ...rawSession(), consent: { granted: false } };
    const res = await h({ method: 'POST', body: { sessions: [nonConsenting] } });
    expect(res.body.accepted).toBe(0);
    expect(res.body.rejected).toBe(1);
    expect(store.puts).toHaveLength(0);
  });

  it('rejects non-POST methods', async () => {
    const { h } = handler();
    expect((await h({ method: 'GET', body: null })).status).toBe(405);
  });
});
