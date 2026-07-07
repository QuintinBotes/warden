import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BrowserError } from '@warden/core';
import { PlaywrightEngine, buildPlaywrightSession, type PlaywrightPage } from './playwright-engine';

function fakePage(): { page: PlaywrightPage; calls: string[] } {
  const calls: string[] = [];
  const locator = (desc: string) => ({
    async click() {
      calls.push(`click ${desc}`);
    },
    async fill(value: string) {
      calls.push(`fill ${desc} ${value}`);
    },
  });
  const page: PlaywrightPage = {
    async goto(url) {
      calls.push(`goto ${url}`);
    },
    getByRole(role, options) {
      return locator(`role=${role} name=${options?.name ?? ''}`);
    },
    getByLabel(label) {
      return locator(`label=${label}`);
    },
    async screenshot(options) {
      calls.push(`screenshot ${options.path}`);
    },
    url() {
      return 'http://localhost/checkout';
    },
    async title() {
      return 'Checkout';
    },
    async innerText(selector) {
      calls.push(`innerText ${selector}`);
      return 'page body';
    },
    async setViewportSize(size) {
      calls.push(`viewport ${size.width}x${size.height}`);
    },
  };
  return { page, calls };
}

describe('PlaywrightEngine', () => {
  it('is named "playwright"', () => {
    expect(new PlaywrightEngine().name).toBe('playwright');
  });
});

describe('buildPlaywrightSession', () => {
  it('maps goto onto page.goto', async () => {
    const { page, calls } = fakePage();
    const session = buildPlaywrightSession(page);
    await session.goto('https://example.com');
    expect(calls).toContain('goto https://example.com');
  });

  it('maps click onto page.getByRole(...).click()', async () => {
    const { page, calls } = fakePage();
    const session = buildPlaywrightSession(page);
    await session.click('button', 'Pay now');
    expect(calls).toContain('click role=button name=Pay now');
  });

  it('maps fill onto page.getByLabel(...).fill()', async () => {
    const { page, calls } = fakePage();
    const session = buildPlaywrightSession(page);
    await session.fill('Card number', '4242');
    expect(calls).toContain('fill label=Card number 4242');
  });

  it('maps screenshot onto page.screenshot({ path })', async () => {
    const { page, calls } = fakePage();
    const session = buildPlaywrightSession(page);
    await session.screenshot('/tmp/out.png');
    expect(calls).toContain('screenshot /tmp/out.png');
  });

  it('maps readPage onto url/title/innerText', async () => {
    const { page } = fakePage();
    const session = buildPlaywrightSession(page);
    await expect(session.readPage()).resolves.toEqual({
      url: 'http://localhost/checkout',
      title: 'Checkout',
      text: 'page body',
    });
  });

  it('maps setViewport onto page.setViewportSize', async () => {
    const { page, calls } = fakePage();
    const session = buildPlaywrightSession(page);
    await session.setViewport(390, 844);
    expect(calls).toContain('viewport 390x844');
  });

  it('runs the cleanup callback on close', async () => {
    const { page } = fakePage();
    let cleaned = false;
    const session = buildPlaywrightSession(page, async () => {
      cleaned = true;
    });
    await session.close();
    expect(cleaned).toBe(true);
  });

  it('throws a BrowserError from act() (playwright has no AI actions)', async () => {
    const { page } = fakePage();
    const session = buildPlaywrightSession(page);
    await expect(session.act('do something clever')).rejects.toBeInstanceOf(BrowserError);
  });

  it('throws a BrowserError from extract()', async () => {
    const { page } = fakePage();
    const session = buildPlaywrightSession(page);
    await expect(
      session.extract('read total', z.object({ total: z.number() })),
    ).rejects.toBeInstanceOf(BrowserError);
  });
});
