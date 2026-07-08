import { describe, expect, it } from 'vitest';
import type { VisualBaselineKey } from '@warden/core';
import { GitBaselineStore } from './git-baseline-store.js';
import { fixtureShot, memVisualFs } from './testing-fakes.js';

const key: VisualBaselineKey = { module: 'apps/checkout', viewport: 'desktop', theme: 'light' };

function store() {
  return new GitBaselineStore({
    baselinesDir: 'tests/visual/baselines/',
    fs: memVisualFs(),
    now: () => '2026-07-08T12:00:00.000Z',
  });
}

describe('GitBaselineStore', () => {
  it('does not surface a pending baseline as committed (never auto-approved)', async () => {
    const s = store();
    await s.putPending(key, fixtureShot(), 'sha-1');

    expect(await s.get(key)).toBeNull();
  });

  it('promotes a pending baseline on approve, stamping approvedBy/approvedAt', async () => {
    const s = store();
    const shot = fixtureShot();
    await s.putPending(key, shot, 'sha-2');

    const approved = await s.approve(key, 'alice');

    expect(approved.approvedBy).toBe('alice');
    expect(approved.approvedAt).toBe('2026-07-08T12:00:00.000Z');
    expect(approved.sourceSha).toBe('sha-2');
    expect(approved.path).toBe('tests/visual/baselines/apps-checkout__desktop__light.png');

    const committed = await s.get(key);
    expect(committed).not.toBeNull();
    expect(await s.read(committed!)).toEqual(shot.png);
  });

  it('lists committed baselines and filters by module', async () => {
    const s = store();
    await s.putPending(key, fixtureShot(), 'sha');
    await s.approve(key, 'alice');
    const other: VisualBaselineKey = { module: 'apps/other', viewport: 'desktop', theme: 'light' };
    await s.putPending(other, fixtureShot(), 'sha');
    await s.approve(other, 'bob');

    expect(await s.list()).toHaveLength(2);
    const filtered = await s.list('apps/checkout');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.key.module).toBe('apps/checkout');
  });

  it('throws when approving with no pending candidate', async () => {
    await expect(store().approve(key, 'alice')).rejects.toThrow(/no pending/i);
  });
});
