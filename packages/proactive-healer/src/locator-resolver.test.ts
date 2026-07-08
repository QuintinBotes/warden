import { describe, expect, it } from 'vitest';
import type { LocatorRef } from '@warden/core';
import { resolveLocators } from './locator-resolver.js';
import { fakeLocatingSession } from './testing-fakes.js';

const refs: LocatorRef[] = [
  { filePath: 'a.spec.ts', line: 1, kind: 'click', role: 'button', name: 'Buy' },
  { filePath: 'a.spec.ts', line: 2, kind: 'click', role: 'button', name: 'Gone' },
  { filePath: 'a.spec.ts', line: 3, kind: 'fill', role: 'label', name: 'Dup' },
];

describe('resolveLocators', () => {
  it('maps matchCount 1/0/>1 to resolved/missing/ambiguous', async () => {
    const session = fakeLocatingSession({
      locate: (_kind, _role, name) => (name === 'Buy' ? 1 : name === 'Gone' ? 0 : 2),
    });

    const { resolutions, skippedReason } = await resolveLocators(refs, session);

    expect(skippedReason).toBeUndefined();
    expect(resolutions).toEqual([
      { locator: refs[0], status: 'resolved', matchCount: 1 },
      { locator: refs[1], status: 'missing', matchCount: 0 },
      { locator: refs[2], status: 'ambiguous', matchCount: 2 },
    ]);
    expect(session.locateCalls).toEqual([
      { kind: 'click', role: 'button', name: 'Buy' },
      { kind: 'click', role: 'button', name: 'Gone' },
      { kind: 'fill', role: 'label', name: 'Dup' },
    ]);
  });

  it('skips with a stated reason when the engine has no locate()', async () => {
    const session = fakeLocatingSession(); // no locate
    const { resolutions, skippedReason } = await resolveLocators(refs, session);

    expect(resolutions).toEqual([]);
    expect(skippedReason).toMatch(/does not implement locate/);
  });
});
