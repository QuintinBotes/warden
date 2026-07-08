import { describe, expect, it } from 'vitest';
import type { BrowserLaunchOptions, GridConfig } from '@warden/core';
import { GridCapacityError, type GridConnection, type GridHttpClient } from '../http-client';
import { BROWSERSTACK_SPEC, BrowserStackProvider } from './browserstack';
import type { CatalogEntry, CloudProviderDeps, OpenSessionResponse } from './cloud-base';

interface Recorded {
  method: 'GET' | 'POST' | 'CONNECT';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface FakeOpts {
  catalog?: CatalogEntry[];
  sessionResponse?: OpenSessionResponse;
}

function fakeHttp(opts: FakeOpts = {}): GridHttpClient & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
      calls.push({ method: 'GET', url, headers });
      return (opts.catalog ?? []) as T;
    },
    async postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
      calls.push({ method: 'POST', url, body, headers });
      if (url.endsWith('/status')) return {} as T;
      return (opts.sessionResponse ?? { sessionId: 'sess-1' }) as T;
    },
    connect(endpoint: string): GridConnection {
      calls.push({ method: 'CONNECT', url: endpoint });
      return { endpoint };
    },
  };
}

function gridConfig(over: Partial<GridConfig> = {}): GridConfig {
  return {
    enabled: true,
    provider: 'browserstack',
    maxShards: 4,
    balanceBy: 'duration',
    matrix: { browsers: ['safari'], devices: ['iPhone 15'] },
    ...over,
  };
}

const env = { BROWSERSTACK_USERNAME: 'user1', BROWSERSTACK_ACCESS_KEY: 'key1' };
const expectedAuth = `Basic ${Buffer.from('user1:key1').toString('base64')}`;
const launchOpts: BrowserLaunchOptions = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
};

function deps(http: GridHttpClient, over: Partial<CloudProviderDeps> = {}): CloudProviderDeps {
  return { http, env, config: gridConfig(), sleep: async () => {}, ...over };
}

const CATALOG: CatalogEntry[] = [
  { browser: 'chromium', os: 'Windows', osVersion: '11' },
  {
    browser: 'safari',
    browserVersion: '17',
    os: 'ios',
    osVersion: '17.0',
    device: 'iPhone 15',
    real: true,
  },
];

describe('BrowserStackProvider', () => {
  it('is named browserstack', () => {
    expect(new BrowserStackProvider(deps(fakeHttp())).name).toBe('browserstack');
  });

  it('GETs the catalog with Basic auth from the injected env and resolves desktop lanes', async () => {
    const http = fakeHttp({ catalog: CATALOG });
    const caps = await new BrowserStackProvider(deps(http)).capabilities({
      browsers: ['chromium'],
    });
    const get = http.calls.find((c) => c.method === 'GET')!;
    expect(get.url).toBe(BROWSERSTACK_SPEC.catalogUrl);
    expect(get.headers?.authorization).toBe(expectedAuth);
    expect(caps).toEqual([
      {
        id: 'browserstack:chromium',
        browser: 'chromium',
        platform: 'windows',
        platformVersion: '11',
        real: false,
      },
    ]);
  });

  it('resolves a real-device lane crossing browsers × devices', async () => {
    const http = fakeHttp({ catalog: CATALOG });
    const caps = await new BrowserStackProvider(deps(http)).capabilities({
      browsers: ['safari'],
      devices: ['iPhone 15'],
    });
    expect(caps).toEqual([
      {
        id: 'browserstack:safari-17:iphone-15',
        browser: 'safari',
        platform: 'ios',
        platformVersion: '17.0',
        device: 'iPhone 15',
        browserVersion: '17',
        real: true,
      },
    ]);
  });

  it('omits a requested device that the live catalog does not serve', async () => {
    const http = fakeHttp({ catalog: CATALOG });
    const caps = await new BrowserStackProvider(deps(http)).capabilities({
      browsers: ['safari'],
      devices: ['Pixel 99'],
    });
    expect(caps).toEqual([]);
  });

  it('POSTs a provisioning request and returns the connected endpoint + replay', async () => {
    const http = fakeHttp({
      catalog: CATALOG,
      sessionResponse: { sessionId: 'sess-9', replayUrl: 'https://replay/9' },
    });
    const provider = new BrowserStackProvider(deps(http));
    const [cap] = await provider.capabilities({ browsers: ['safari'], devices: ['iPhone 15'] });
    const info = await provider.openSession(cap!, launchOpts);

    const post = http.calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(BROWSERSTACK_SPEC.sessionUrl);
    expect(post.headers?.authorization).toBe(expectedAuth);
    expect(post.body).toMatchObject({
      browserName: 'safari',
      platformName: 'ios',
      device: 'iPhone 15',
      realMobile: true,
      headless: true,
    });
    // config.project is unset, so it is pruned from the payload entirely.
    expect(post.body as Record<string, unknown>).not.toHaveProperty('project');
    expect(info.sessionId).toBe('sess-9');
    expect(info.endpoint).toBe(`${BROWSERSTACK_SPEC.hubUrl}/session/sess-9`);
    expect(info.replayUrl).toBe('https://replay/9');
    expect(http.calls.some((c) => c.method === 'CONNECT')).toBe(true);
  });

  it('stamps the project/build when configured', async () => {
    const http = fakeHttp({ catalog: CATALOG });
    const provider = new BrowserStackProvider(
      deps(http, { config: gridConfig({ project: 'checkout-release' }) }),
    );
    const [cap] = await provider.capabilities({ browsers: ['safari'], devices: ['iPhone 15'] });
    await provider.openSession(cap!, launchOpts);
    const post = http.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ project: 'checkout-release', build: 'checkout-release' });
  });

  it('retries with bounded backoff on a queue-full response then raises GridCapacityError', async () => {
    let sleeps = 0;
    const http = fakeHttp({ catalog: CATALOG, sessionResponse: { status: 'queue_full' } });
    const provider = new BrowserStackProvider(
      deps(http, { openRetries: 3, backoffMs: 1, sleep: async () => void sleeps++ }),
    );
    const [cap] = await provider.capabilities({ browsers: ['safari'], devices: ['iPhone 15'] });
    await expect(provider.openSession(cap!, launchOpts)).rejects.toBeInstanceOf(GridCapacityError);
    const posts = http.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(3);
    expect(sleeps).toBe(2);
  });

  it('closeSession POSTs the final outcome to the session status endpoint', async () => {
    const http = fakeHttp({ catalog: CATALOG, sessionResponse: { sessionId: 'sess-3' } });
    const provider = new BrowserStackProvider(deps(http));
    const [cap] = await provider.capabilities({ browsers: ['safari'], devices: ['iPhone 15'] });
    const info = await provider.openSession(cap!, launchOpts);
    await provider.closeSession(info, 'failed');
    const close = http.calls.find((c) => c.method === 'POST' && c.url.endsWith('/status'))!;
    expect(close.url).toBe(`${BROWSERSTACK_SPEC.sessionUrl}/sess-3/status`);
    expect(close.body).toEqual({ status: 'failed' });
    expect(close.headers?.authorization).toBe(expectedAuth);
  });
});
