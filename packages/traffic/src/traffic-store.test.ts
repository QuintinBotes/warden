import { describe, expect, it } from 'vitest';
import type { RecordedSession } from '@warden/core';
import { fsTrafficStore, type TrafficStoreFs } from './traffic-store.js';
import { inMemoryTrafficStore } from './testing-fakes.js';

const DAY = 24 * 60 * 60 * 1000;

function session(url: string): RecordedSession {
  return { url, startedAt: new Date('2026-07-08T10:00:00.000Z'), steps: [{ action: 'goto' }] };
}

/** A minimal in-memory filesystem for the fs-backed store. */
function memFs(): TrafficStoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readdir(dir) {
      const prefix = `${dir.replace(/\/+$/, '')}/`;
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map((k) => k.slice(prefix.length));
    },
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    async writeFile(path, data) {
      files.set(path, data);
    },
    async unlink(path) {
      files.delete(path);
    },
    async mkdir() {
      /* no-op */
    },
  };
}

describe('inMemoryTrafficStore', () => {
  it('prunes only sessions older than ttlDays and returns the count', async () => {
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const store = inMemoryTrafficStore({ now: () => new Date(nowMs) });

    await store.put(session('https://shop.test/a')); // stored at day 0
    nowMs += 40 * DAY;
    await store.put(session('https://shop.test/b')); // stored at day 40

    nowMs += 5 * DAY; // now = day 45; cutoff for ttl 30 = day 15
    const pruned = await store.prune(30);

    expect(pruned).toBe(1);
    const remaining = await store.list();
    expect(remaining.map((s) => s.url)).toEqual(['https://shop.test/b']);
  });

  it('records every put for assertions', async () => {
    const store = inMemoryTrafficStore();
    await store.put(session('https://shop.test/x'));
    expect(store.puts).toHaveLength(1);
  });
});

describe('fsTrafficStore', () => {
  it('round-trips scrubbed sessions through the injected filesystem, reviving dates', async () => {
    const fs = memFs();
    const store = fsTrafficStore({ dir: '/traffic/', fs, now: () => new Date('2026-01-01') });
    await store.put(session('https://shop.test/a'));
    await store.put(session('https://shop.test/b'));

    const listed = await store.list();
    expect(listed.map((s) => s.url).sort()).toEqual(['https://shop.test/a', 'https://shop.test/b']);
    expect(listed[0]!.startedAt).toBeInstanceOf(Date);
    expect(fs.files.size).toBe(2);
  });

  it('prunes expired files via the injected clock', async () => {
    const fs = memFs();
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const store = fsTrafficStore({ dir: '/traffic', fs, now: () => new Date(nowMs) });

    await store.put(session('https://shop.test/old'));
    nowMs += 40 * DAY;
    await store.put(session('https://shop.test/new'));
    nowMs += 5 * DAY;

    const pruned = await store.prune(30);
    expect(pruned).toBe(1);
    const listed = await store.list();
    expect(listed.map((s) => s.url)).toEqual(['https://shop.test/new']);
  });
});
