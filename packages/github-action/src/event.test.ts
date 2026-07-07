import { describe, expect, it } from 'vitest';
import { ConfigError } from '@warden/core';
import { loadPrEvent, resolveRepo } from './event.js';
import type { FsLike } from './types.js';

const prEvent = {
  pull_request: {
    number: 123,
    title: 'Add payment retry',
    html_url: 'https://github.com/acme/shop/pull/123',
    head: { sha: 'headsha' },
    base: { sha: 'basesha' },
    user: { login: 'octocat' },
  },
  repository: { name: 'shop', owner: { login: 'acme' } },
};

function fakeFs(contents: string): FsLike {
  return { readFileSync: () => contents };
}

describe('loadPrEvent', () => {
  it('maps a pull_request event payload into a PrContext', () => {
    const pr = loadPrEvent('/event.json', fakeFs(JSON.stringify(prEvent)));
    expect(pr).toEqual({
      number: 123,
      title: 'Add payment retry',
      url: 'https://github.com/acme/shop/pull/123',
      headSha: 'headsha',
      baseSha: 'basesha',
      author: 'octocat',
      repo: { owner: 'acme', repo: 'shop' },
    });
  });

  it('returns null when the event has no pull_request (e.g. a push)', () => {
    const pr = loadPrEvent('/event.json', fakeFs(JSON.stringify({ ref: 'refs/heads/main' })));
    expect(pr).toBeNull();
  });

  it('returns null when no event path is provided', () => {
    expect(loadPrEvent(undefined, fakeFs('{}'))).toBeNull();
  });

  it('throws ConfigError on unreadable event path', () => {
    const fs: FsLike = {
      readFileSync: () => {
        throw new Error('ENOENT');
      },
    };
    expect(() => loadPrEvent('/missing.json', fs)).toThrow(ConfigError);
  });

  it('throws ConfigError on invalid JSON', () => {
    expect(() => loadPrEvent('/event.json', fakeFs('not json'))).toThrow(ConfigError);
  });
});

describe('resolveRepo', () => {
  it('keeps the event repo when present', () => {
    const pr = loadPrEvent('/e.json', fakeFs(JSON.stringify(prEvent)))!;
    expect(resolveRepo(pr, {})).toEqual({ owner: 'acme', repo: 'shop' });
  });

  it('falls back to GITHUB_REPOSITORY when the event omits the repo', () => {
    const noRepo = { pull_request: { number: 1, head: { sha: 'h' }, base: { sha: 'b' } } };
    const pr = loadPrEvent('/e.json', fakeFs(JSON.stringify(noRepo)))!;
    expect(resolveRepo(pr, { GITHUB_REPOSITORY: 'octo/widgets' })).toEqual({
      owner: 'octo',
      repo: 'widgets',
    });
  });
});
