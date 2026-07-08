import { describe, expect, it } from 'vitest';
import { defineConfig, type GitHubAccess, type VisualBaselineKey } from '@warden/core';
import { approveBaseline } from './approve.js';
import { compareCheck, keyOf } from './compare.js';
import {
  fakeBaselineStore,
  fakeVisualEngine,
  fixtureCheck,
  fixtureShot,
  memArtifactSink,
} from './testing-fakes.js';

const key: VisualBaselineKey = { module: 'apps/checkout', viewport: 'desktop', theme: 'light' };

interface DraftCall {
  repo: string;
  branch: string;
  files: { path: string; content: string | null }[];
  title: string;
  body: string;
}

function recordingGh(): GitHubAccess & { draftPrCalls: DraftCall[] } {
  const draftPrCalls: DraftCall[] = [];
  return {
    draftPrCalls,
    async openOrUpdateDraftPr(repo, branch, files, title, body) {
      draftPrCalls.push({ repo, branch, files, title, body });
      return { url: 'https://github.com/o/r/pull/7', number: 7 };
    },
    async addPrSuggestions() {},
    async postCheckRun() {},
  };
}

describe('approveBaseline', () => {
  it('promotes the pending candidate and records approvedBy without a GitHubAccess', async () => {
    const store = fakeBaselineStore();
    await store.putPending(key, fixtureShot(), 'sha-1');

    const result = await approveBaseline(key, 'alice', store);

    expect(result.committed).toBe(false);
    expect(result.baseline.approvedBy).toBe('alice');
    expect(store.approveCalls).toEqual([{ key, approvedBy: 'alice' }]);
  });

  it('commits the promoted baseline PNG through the injected GitHubAccess', async () => {
    const store = fakeBaselineStore();
    const shot = fixtureShot();
    await store.putPending(key, shot, 'sha-2');
    const gh = recordingGh();

    const result = await approveBaseline(key, 'bob', store, gh);

    expect(result.committed).toBe(true);
    expect(result.draftPr?.number).toBe(7);
    expect(gh.draftPrCalls).toHaveLength(1);
    const call = gh.draftPrCalls[0]!;
    expect(call.files[0]!.path).toBe(result.baseline.path);
    expect(new Uint8Array(Buffer.from(call.files[0]!.content!, 'base64'))).toEqual(shot.png);
  });

  it('makes the next run MATCH after approval', async () => {
    const check = fixtureCheck();
    const store = fakeBaselineStore();
    const shot = fixtureShot({ check });
    await store.putPending(keyOf(check), shot, 'sha-3');
    await approveBaseline(keyOf(check), 'alice', store);

    const result = await compareCheck({
      check,
      engine: fakeVisualEngine(() => shot),
      store,
      cfg: defineConfig({ visual: { enabled: true } }),
      sourceSha: 'sha-3',
      artifacts: memArtifactSink(),
    });

    expect(result.status).toBe('MATCH');
  });
});
