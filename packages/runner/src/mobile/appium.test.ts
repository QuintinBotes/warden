import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BrowserError, type PageState } from '@warden/core';
import {
  AppiumBrowserSession,
  createAppiumSession,
  type WebdriverElementLike,
  type WebdriverLike,
} from './appium';

function fakeDriver(opts: { page?: PageState } = {}): WebdriverLike & { calls: string[] } {
  const calls: string[] = [];
  const element = (selector: string): WebdriverElementLike => ({
    async click() {
      calls.push(`click ${selector}`);
    },
    async setValue(value: string) {
      calls.push(`setValue ${selector} ${value}`);
    },
  });
  return {
    calls,
    async url(url) {
      calls.push(`url ${url}`);
    },
    async $(selector) {
      calls.push(`$ ${selector}`);
      return element(selector);
    },
    async saveScreenshot(path) {
      calls.push(`saveScreenshot ${path}`);
    },
    async getUrl() {
      return opts.page?.url ?? 'app://home';
    },
    async getTitle() {
      return opts.page?.title ?? 'Home';
    },
    async getPageSource() {
      return opts.page?.text ?? '<hierarchy/>';
    },
    async setWindowSize(width, height) {
      calls.push(`setWindowSize ${width}x${height}`);
    },
    async deleteSession() {
      calls.push('deleteSession');
    },
  };
}

describe('AppiumBrowserSession', () => {
  it('maps goto onto driver.url', async () => {
    const driver = fakeDriver();
    await createAppiumSession(driver).goto('app://login');
    expect(driver.calls).toContain('url app://login');
  });

  it('resolves click by accessibility id and clicks it', async () => {
    const driver = fakeDriver();
    await createAppiumSession(driver).click('button', 'Sign in');
    expect(driver.calls).toContain('$ ~Sign in');
    expect(driver.calls).toContain('click ~Sign in');
  });

  it('resolves fill by accessibility id and sets its value', async () => {
    const driver = fakeDriver();
    await createAppiumSession(driver).fill('Email', 'user@example.com');
    expect(driver.calls).toContain('$ ~Email');
    expect(driver.calls).toContain('setValue ~Email user@example.com');
  });

  it('maps screenshot onto driver.saveScreenshot', async () => {
    const driver = fakeDriver();
    await createAppiumSession(driver).screenshot('/tmp/mobile.png');
    expect(driver.calls).toContain('saveScreenshot /tmp/mobile.png');
  });

  it('reads page state from url/title/pageSource', async () => {
    const page: PageState = { url: 'app://cart', title: 'Cart', text: '<xml/>' };
    const session = createAppiumSession(fakeDriver({ page }));
    await expect(session.readPage()).resolves.toEqual(page);
  });

  it('maps setViewport onto driver.setWindowSize', async () => {
    const driver = fakeDriver();
    await createAppiumSession(driver).setViewport(390, 844);
    expect(driver.calls).toContain('setWindowSize 390x844');
  });

  it('closes by deleting the appium session', async () => {
    const driver = fakeDriver();
    await createAppiumSession(driver).close();
    expect(driver.calls).toContain('deleteSession');
  });

  it('throws a BrowserError from act() (appium is deterministic-only)', async () => {
    const session = new AppiumBrowserSession(fakeDriver());
    await expect(session.act('do something clever')).rejects.toBeInstanceOf(BrowserError);
  });

  it('throws a BrowserError from extract()', async () => {
    const session = new AppiumBrowserSession(fakeDriver());
    await expect(
      session.extract('read total', z.object({ total: z.number() })),
    ).rejects.toBeInstanceOf(BrowserError);
  });

  it('createAppiumSession returns an AppiumBrowserSession', () => {
    expect(createAppiumSession(fakeDriver())).toBeInstanceOf(AppiumBrowserSession);
  });
});
