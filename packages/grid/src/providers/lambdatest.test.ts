import { describe, expect, it } from 'vitest';
import type { BrowserLaunchOptions, GridConfig } from '@warden/core';
import type { GridConnection, GridHttpClient } from '../http-client';
import { LAMBDATEST_SPEC, LambdaTestProvider } from './lambdatest';
import type { CatalogEntry, CloudProviderDeps, OpenSessionResponse } from './cloud-base';

interface Recorded {
  method: 'GET' | 'POST' | 'CONNECT';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function fakeHttp(
  catalog: CatalogEntry[],
  session?: OpenSessionResponse,
): GridHttpClient & {
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    calls,
    async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
      calls.push({ method: 'GET', url, headers });
      return catalog as T;
    },
    async postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
      calls.push({ method: 'POST', url, body, headers });
      if (url.endsWith('/status')) return {} as T;
      return (session ?? { sessionId: 'lt-1' }) as T;
    },
    connect(endpoint: string): GridConnection {
      calls.push({ method: 'CONNECT', url: endpoint });
      return { endpoint };
    },
  };
}

const config: GridConfig = {
  enabled: true,
  provider: 'lambdatest',
  maxShards: 2,
  balanceBy: 'count',
  matrix: { browsers: ['edge'], devices: [] },
};

const env = { LT_USERNAME: 'lu', LT_ACCESS_KEY: 'lk' };
const expectedAuth = `Basic ${Buffer.from('lu:lk').toString('base64')}`;
const launchOpts: BrowserLaunchOptions = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
};

function deps(http: GridHttpClient): CloudProviderDeps {
  return { http, env, config, sleep: async () => {} };
}

const CATALOG: CatalogEntry[] = [
  { browser: 'edge', browserVersion: '120', os: 'Windows', osVersion: '11' },
];

describe('LambdaTestProvider', () => {
  it('resolves lanes from the LambdaTest catalog with Basic auth', async () => {
    const http = fakeHttp(CATALOG);
    const provider = new LambdaTestProvider(deps(http));
    expect(provider.name).toBe('lambdatest');
    const caps = await provider.capabilities({ browsers: ['edge'] });
    const get = http.calls.find((c) => c.method === 'GET')!;
    expect(get.url).toBe(LAMBDATEST_SPEC.catalogUrl);
    expect(get.headers?.authorization).toBe(expectedAuth);
    expect(caps).toEqual([
      {
        id: 'lambdatest:edge-120',
        browser: 'edge',
        platform: 'windows',
        platformVersion: '11',
        browserVersion: '120',
        real: false,
      },
    ]);
  });

  it('provisions a session against the LambdaTest endpoints', async () => {
    const http = fakeHttp(CATALOG, { sessionId: 'lt-42', replayUrl: 'https://lt/replay/42' });
    const provider = new LambdaTestProvider(deps(http));
    const [cap] = await provider.capabilities({ browsers: ['edge'] });
    const info = await provider.openSession(cap!, launchOpts);
    const post = http.calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(LAMBDATEST_SPEC.sessionUrl);
    expect(post.body).toMatchObject({ browserName: 'edge', platformName: 'windows' });
    expect(info.endpoint).toBe(`${LAMBDATEST_SPEC.hubUrl}/session/lt-42`);
    expect(info.replayUrl).toBe('https://lt/replay/42');
  });
});
