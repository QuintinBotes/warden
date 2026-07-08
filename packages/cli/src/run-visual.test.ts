import { describe, expect, it } from 'vitest';
import type {
  GitHubAccess,
  VisualBaseline,
  VisualBaselineKey,
  VisualBaselineStore,
  VisualShot,
} from '@warden/core';
import { runVisualApprove } from './run-visual';

interface StubStore extends VisualBaselineStore {
  approveCalls: { key: VisualBaselineKey; approvedBy: string }[];
}

function stubStore(): StubStore {
  const approveCalls: { key: VisualBaselineKey; approvedBy: string }[] = [];
  return {
    approveCalls,
    async get(): Promise<VisualBaseline | null> {
      return null;
    },
    async read(): Promise<Uint8Array> {
      return new Uint8Array([1, 2, 3]);
    },
    async putPending(key, shot: VisualShot, sourceSha): Promise<VisualBaseline> {
      return { key, path: 'pending.png', width: shot.width, height: shot.height, sourceSha };
    },
    async approve(key, approvedBy): Promise<VisualBaseline> {
      approveCalls.push({ key, approvedBy });
      return {
        key,
        path: `tests/visual/baselines/${key.module}-${key.viewport}-${key.theme}.png`,
        width: 8,
        height: 8,
        sourceSha: 'sha',
        approvedBy,
        approvedAt: '2026-07-08T00:00:00.000Z',
      };
    },
    async list(): Promise<VisualBaseline[]> {
      return [];
    },
  };
}

describe('runVisualApprove', () => {
  it('approves the default desktop/light baseline for a module', async () => {
    const store = stubStore();

    const result = await runVisualApprove({ module: 'apps/checkout', by: 'alice' }, { store });

    expect(store.approveCalls).toEqual([
      {
        key: { module: 'apps/checkout', viewport: 'desktop', theme: 'light' },
        approvedBy: 'alice',
      },
    ]);
    expect(result.committed).toBe(false);
    expect(result.baseline.approvedBy).toBe('alice');
  });

  it('honors --viewport and --theme', async () => {
    const store = stubStore();

    await runVisualApprove(
      { module: 'apps/checkout', viewport: 'mobile', theme: 'dark', by: 'bob' },
      { store },
    );

    expect(store.approveCalls[0]!.key).toEqual({
      module: 'apps/checkout',
      viewport: 'mobile',
      theme: 'dark',
    });
  });

  it('commits through an injected GitHubAccess', async () => {
    const store = stubStore();
    const draftCalls: unknown[] = [];
    const gh: GitHubAccess = {
      async openOrUpdateDraftPr(repo, branch, files, title, body) {
        draftCalls.push({ repo, branch, files, title, body });
        return { url: 'https://github.com/o/r/pull/3', number: 3 };
      },
      async addPrSuggestions() {},
      async postCheckRun() {},
    };

    const result = await runVisualApprove({ module: 'apps/checkout', by: 'alice' }, { store, gh });

    expect(result.committed).toBe(true);
    expect(draftCalls).toHaveLength(1);
  });
});
