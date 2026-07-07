import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BrowserError, defineConfig, type WardenConfig } from '@warden/core';
import { StagehandEngine, buildStagehandSession, type StagehandLike } from './stagehand';
import { createEngine } from '../create-engine';
import type { PlaywrightPage } from '../playwright-engine';

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
      return 'http://localhost/cart';
    },
    async title() {
      return 'Cart';
    },
    async innerText() {
      return 'cart body';
    },
    async setViewportSize(size) {
      calls.push(`viewport ${size.width}x${size.height}`);
    },
  };
  return { page, calls };
}

function fakeStagehand(
  opts: { extractValue?: unknown } = {},
): StagehandLike & { calls: { method: string; arg: string }[] } {
  const calls: { method: string; arg: string }[] = [];
  return {
    calls,
    async act(action) {
      calls.push({ method: 'act', arg: action });
    },
    async extract(instruction) {
      calls.push({ method: 'extract', arg: instruction });
      return opts.extractValue ?? {};
    },
  };
}

function browserFor(engine: 'stagehand'): WardenConfig['browser'] {
  return defineConfig({ browser: { engine } }).browser;
}

describe('StagehandEngine', () => {
  it('is named "stagehand"', () => {
    expect(new StagehandEngine(fakeStagehand()).name).toBe('stagehand');
  });
});

describe('buildStagehandSession', () => {
  it('delegates act to the injected stagehand client', async () => {
    const { page } = fakePage();
    const stagehand = fakeStagehand();
    const session = buildStagehandSession(page, stagehand);
    await session.act('add the first result to the cart');
    expect(stagehand.calls).toContainEqual({
      method: 'act',
      arg: 'add the first result to the cart',
    });
  });

  it('validates extract output from the client against the zod schema', async () => {
    const { page } = fakePage();
    const stagehand = fakeStagehand({ extractValue: { total: 42 } });
    const session = buildStagehandSession(page, stagehand);
    const value = await session.extract('read the cart total', z.object({ total: z.number() }));
    expect(value).toEqual({ total: 42 });
    expect(stagehand.calls).toContainEqual({ method: 'extract', arg: 'read the cart total' });
  });

  it('throws when extract output does not match the schema', async () => {
    const { page } = fakePage();
    const stagehand = fakeStagehand({ extractValue: { total: 'nope' } });
    const session = buildStagehandSession(page, stagehand);
    await expect(
      session.extract('read the cart total', z.object({ total: z.number() })),
    ).rejects.toThrow();
  });

  it('runs deterministic interactions on the playwright page (not the stagehand client)', async () => {
    const { page, calls } = fakePage();
    const stagehand = fakeStagehand();
    const session = buildStagehandSession(page, stagehand);
    await session.goto('https://shop.example.com');
    await session.click('button', 'Search');
    await session.fill('Query', 'boots');
    expect(calls).toEqual([
      'goto https://shop.example.com',
      'click role=button name=Search',
      'fill label=Query boots',
    ]);
    expect(stagehand.calls).toEqual([]);
  });

  it('runs the cleanup callback on close', async () => {
    const { page } = fakePage();
    let cleaned = false;
    const session = buildStagehandSession(page, fakeStagehand(), async () => {
      cleaned = true;
    });
    await session.close();
    expect(cleaned).toBe(true);
  });
});

describe('createEngine (stagehand)', () => {
  it('returns a StagehandEngine when a stagehand client is injected', () => {
    const engine = createEngine(browserFor('stagehand'), { stagehand: fakeStagehand() });
    expect(engine).toBeInstanceOf(StagehandEngine);
    expect(engine.name).toBe('stagehand');
  });

  it('throws a BrowserError for stagehand when no client is injected', () => {
    expect(() => createEngine(browserFor('stagehand'))).toThrow(BrowserError);
  });
});
