import { describe, expect, it } from 'vitest';
import type { GridCapability } from '@warden/core';
import { createAppiumSession } from './appium';
import { createGridWebdriver, toW3CCapabilities, type GridWebdriverHttp } from './grid-webdriver';

interface Recorded {
  method: 'POST' | 'GET' | 'DELETE';
  url: string;
  body?: unknown;
}

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecc';

function fakeHttp(): GridWebdriverHttp & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    async post<T>(url: string, body?: unknown): Promise<T> {
      calls.push({ method: 'POST', url, body });
      if (url.endsWith('/session')) return { value: { sessionId: 'sess-1' } } as T;
      if (url.endsWith('/element')) return { value: { [W3C_ELEMENT_KEY]: 'el-1' } } as T;
      return {} as T;
    },
    async get<T>(url: string): Promise<T> {
      calls.push({ method: 'GET', url });
      if (url.endsWith('/url')) return { value: 'https://app/home' } as T;
      if (url.endsWith('/title')) return { value: 'Home' } as T;
      if (url.endsWith('/source')) return { value: '<html/>' } as T;
      return { value: '' } as T;
    },
    async del<T>(url: string): Promise<T> {
      calls.push({ method: 'DELETE', url });
      return {} as T;
    },
  };
}

const capability: GridCapability = {
  id: 'browserstack:safari-17:iphone-15',
  browser: 'safari',
  browserVersion: '17',
  platform: 'ios',
  platformVersion: '17.0',
  device: 'iPhone 15',
  real: true,
};

const ENDPOINT = 'https://hub-cloud.browserstack.com/wd/hub';

describe('toW3CCapabilities', () => {
  it('maps a grid capability onto W3C + appium capability keys', () => {
    expect(toW3CCapabilities(capability)).toEqual({
      browserName: 'safari',
      browserVersion: '17',
      platformName: 'ios',
      'appium:deviceName': 'iPhone 15',
      'appium:platformVersion': '17.0',
    });
  });
});

describe('createGridWebdriver', () => {
  it('lazily creates a session that sends the endpoint + capability, then drives goto', async () => {
    const http = fakeHttp();
    const session = createAppiumSession(createGridWebdriver(ENDPOINT, capability, http));
    await session.goto('https://app/login');

    const create = http.calls.find((c) => c.url === `${ENDPOINT}/session`)!;
    expect(create.method).toBe('POST');
    expect(create.body).toEqual({ capabilities: { alwaysMatch: toW3CCapabilities(capability) } });

    const nav = http.calls.find((c) => c.url.endsWith('/url') && c.method === 'POST')!;
    expect(nav.url).toBe(`${ENDPOINT}/session/sess-1/url`);
    expect(nav.body).toEqual({ url: 'https://app/login' });
  });

  it('routes a deterministic click through an accessibility-id locator', async () => {
    const http = fakeHttp();
    const session = createAppiumSession(createGridWebdriver(ENDPOINT, capability, http));
    await session.click('button', 'Sign in');

    const find = http.calls.find((c) => c.url.endsWith('/element') && c.method === 'POST')!;
    expect(find.body).toEqual({ using: 'accessibility id', value: 'Sign in' });
    const click = http.calls.find((c) => c.url.endsWith('/el-1/click'))!;
    expect(click.url).toBe(`${ENDPOINT}/session/sess-1/element/el-1/click`);
  });

  it('routes a deterministic fill through element value', async () => {
    const http = fakeHttp();
    const session = createAppiumSession(createGridWebdriver(ENDPOINT, capability, http));
    await session.fill('Email', 'user@example.com');

    const setValue = http.calls.find((c) => c.url.endsWith('/el-1/value'))!;
    expect(setValue.body).toEqual({ text: 'user@example.com' });
  });

  it('reuses the same session id across commands (creates it once)', async () => {
    const http = fakeHttp();
    const session = createAppiumSession(createGridWebdriver(ENDPOINT, capability, http));
    await session.goto('https://app/a');
    await session.goto('https://app/b');
    expect(http.calls.filter((c) => c.url === `${ENDPOINT}/session`)).toHaveLength(1);
  });

  it('reads page state from the WebDriver endpoint', async () => {
    const http = fakeHttp();
    const session = createAppiumSession(createGridWebdriver(ENDPOINT, capability, http));
    await expect(session.readPage()).resolves.toEqual({
      url: 'https://app/home',
      title: 'Home',
      text: '<html/>',
    });
  });

  it('deletes the WebDriver session on close', async () => {
    const http = fakeHttp();
    const session = createAppiumSession(createGridWebdriver(ENDPOINT, capability, http));
    await session.goto('https://app/a');
    await session.close();
    expect(
      http.calls.some((c) => c.method === 'DELETE' && c.url === `${ENDPOINT}/session/sess-1`),
    ).toBe(true);
  });
});
