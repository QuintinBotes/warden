import { describe, expect, it } from 'vitest';
import type { BrowserLaunchOptions, GridConfig } from '@warden/core';
import type { GridConnection, GridHttpClient } from '../http-client';
import { SauceLabsProvider, sauceSpec } from './saucelabs';
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
      return (session ?? { sessionId: 'sc-1' }) as T;
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
    provider: 'saucelabs',
    maxShards: 2,
    balanceBy: 'duration',
    matrix: { browsers: ['firefox'], devices: [] },
    ...over,
  };
}

const env = { SAUCE_USERNAME: 'su', SAUCE_ACCESS_KEY: 'sk' };
const expectedAuth = `Basic ${Buffer.from('su:sk').toString('base64')}`;
const launchOpts: BrowserLaunchOptions = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
};

function deps(http: GridHttpClient, config: GridConfig): CloudProviderDeps {
  return { http, env, config, sleep: async () => {} };
}

const CATALOG: CatalogEntry[] = [{ browser: 'firefox', browserVersion: '128', os: 'linux' }];

describe('SauceLabsProvider', () => {
  it('is named saucelabs and defaults to the us-west-1 region endpoints', async () => {
    const http = fakeHttp(CATALOG);
    const provider = new SauceLabsProvider(deps(http, gridConfig()));
    expect(provider.name).toBe('saucelabs');
    await provider.capabilities({ browsers: ['firefox'] });
    const get = http.calls.find((c) => c.method === 'GET')!;
    expect(get.url).toBe(sauceSpec('us-west-1').catalogUrl);
    expect(get.url).toContain('api.us-west-1.saucelabs.com');
    expect(get.headers?.authorization).toBe(expectedAuth);
  });

  it('honours the configured region hint in every endpoint', async () => {
    const http = fakeHttp(CATALOG, { sessionId: 'eu-1' });
    const provider = new SauceLabsProvider(deps(http, gridConfig({ region: 'eu-central-1' })));
    const [cap] = await provider.capabilities({ browsers: ['firefox'] });
    const info = await provider.openSession(cap!, launchOpts);
    const get = http.calls.find((c) => c.method === 'GET')!;
    const post = http.calls.find((c) => c.method === 'POST')!;
    expect(get.url).toContain('api.eu-central-1.saucelabs.com');
    expect(post.url).toBe(sauceSpec('eu-central-1').sessionUrl);
    expect(info.endpoint).toContain('ondemand.eu-central-1.saucelabs.com');
    expect(info.sessionId).toBe('eu-1');
  });

  it('closeSession POSTs the outcome to the regioned status endpoint', async () => {
    const http = fakeHttp(CATALOG, { sessionId: 'sc-7' });
    const provider = new SauceLabsProvider(deps(http, gridConfig()));
    const [cap] = await provider.capabilities({ browsers: ['firefox'] });
    const info = await provider.openSession(cap!, launchOpts);
    await provider.closeSession(info, 'passed');
    const close = http.calls.find((c) => c.method === 'POST' && c.url.endsWith('/status'))!;
    expect(close.url).toBe(`${sauceSpec('us-west-1').sessionUrl}/sc-7/status`);
    expect(close.body).toEqual({ status: 'passed' });
  });
});
