import { describe, expect, it } from 'vitest';
import { ConfigError, type GridConfig } from '@warden/core';
import { createGridProvider } from './create-grid-provider';
import { LocalGridProvider } from './providers/local';
import { BrowserStackProvider } from './providers/browserstack';
import { SauceLabsProvider } from './providers/saucelabs';
import { LambdaTestProvider } from './providers/lambdatest';
import type { GridConnection, GridHttpClient } from './http-client';

function gridConfig(over: Partial<GridConfig> = {}): GridConfig {
  return {
    enabled: false,
    provider: 'local',
    maxShards: 1,
    balanceBy: 'duration',
    matrix: { browsers: ['chromium'], devices: [] },
    ...over,
  };
}

function fakeHttp(): GridHttpClient & { getCalls: number } {
  const state = { getCalls: 0 };
  return {
    get getCalls() {
      return state.getCalls;
    },
    async getJson<T>(): Promise<T> {
      state.getCalls++;
      return [] as T;
    },
    async postJson<T>(): Promise<T> {
      return {} as T;
    },
    connect(endpoint: string): GridConnection {
      return { endpoint };
    },
  };
}

describe('createGridProvider', () => {
  it('selects the local provider and needs no credentials', () => {
    expect(createGridProvider(gridConfig())).toBeInstanceOf(LocalGridProvider);
  });

  it('selects each cloud provider when its credentials are present in the injected env', () => {
    const http = fakeHttp();
    expect(
      createGridProvider(gridConfig({ provider: 'browserstack' }), {
        http,
        env: { BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' },
      }),
    ).toBeInstanceOf(BrowserStackProvider);
    expect(
      createGridProvider(gridConfig({ provider: 'saucelabs' }), {
        http,
        env: { SAUCE_USERNAME: 'u', SAUCE_ACCESS_KEY: 'k' },
      }),
    ).toBeInstanceOf(SauceLabsProvider);
    expect(
      createGridProvider(gridConfig({ provider: 'lambdatest' }), {
        http,
        env: { LT_USERNAME: 'u', LT_ACCESS_KEY: 'k' },
      }),
    ).toBeInstanceOf(LambdaTestProvider);
  });

  it('throws ConfigError up front when cloud credentials are missing', () => {
    expect(() => createGridProvider(gridConfig({ provider: 'browserstack' }), { env: {} })).toThrow(
      ConfigError,
    );
    expect(() =>
      createGridProvider(gridConfig({ provider: 'saucelabs' }), {
        env: { SAUCE_USERNAME: 'only-user' },
      }),
    ).toThrow(/SAUCE_ACCESS_KEY/);
    expect(() => createGridProvider(gridConfig({ provider: 'lambdatest' }), { env: {} })).toThrow(
      /LT_USERNAME and LT_ACCESS_KEY/,
    );
  });

  it('drives the injected http client (no network of its own)', async () => {
    const http = fakeHttp();
    const provider = createGridProvider(gridConfig({ provider: 'browserstack' }), {
      http,
      env: { BROWSERSTACK_USERNAME: 'u', BROWSERSTACK_ACCESS_KEY: 'k' },
    });
    await provider.capabilities({ browsers: ['chromium'] });
    expect(http.getCalls).toBe(1);
  });
});
