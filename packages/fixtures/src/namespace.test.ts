import { describe, expect, it } from 'vitest';
import { deriveNamespace } from './namespace';

describe('deriveNamespace', () => {
  it('is deterministic for the same inputs', () => {
    const a = deriveNamespace({ triggerRef: 'pr-482', tier: 'selective', shardId: 1 });
    const b = deriveNamespace({ triggerRef: 'pr-482', tier: 'selective', shardId: 1 });
    expect(a).toBe(b);
  });

  it('produces readable slug parts plus a hex suffix', () => {
    const ns = deriveNamespace({ triggerRef: 'PR-482', tier: 'selective', shardId: 2 });
    expect(ns).toMatch(/^pr-482-selective-s2-[0-9a-f]{1,6}$/);
  });

  it('never collides across shards of the same PR/tier', () => {
    const s1 = deriveNamespace({ triggerRef: '482', tier: 'selective', shardId: 1 });
    const s2 = deriveNamespace({ triggerRef: '482', tier: 'selective', shardId: 2 });
    expect(s1).not.toBe(s2);
  });

  it('never collides across tiers of the same PR', () => {
    const smoke = deriveNamespace({ triggerRef: '482', tier: 'smoke' });
    const selective = deriveNamespace({ triggerRef: '482', tier: 'selective' });
    expect(smoke).not.toBe(selective);
  });

  it('works with only a trigger ref', () => {
    const ns = deriveNamespace({ triggerRef: 'main@a1b2c3' });
    expect(ns).toMatch(/^main-a1b2c3-[0-9a-f]{1,6}$/);
  });

  it('sanitizes unsafe characters out of the readable parts', () => {
    const ns = deriveNamespace({ triggerRef: 'feature/Fix Thing!', tier: 'full' });
    expect(ns).toMatch(/^[a-z0-9-]+$/);
    expect(ns).not.toMatch(/[/! ]/);
  });
});
