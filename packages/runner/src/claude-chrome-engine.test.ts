import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { BrowserLaunchOptions, PageState } from '@warden/core';
import { ClaudeChromeEngine, type ClaudeChromeMcpClient } from './claude-chrome-engine';

interface RecordedCall {
  method: string;
  args: unknown[];
}

function fakeMcpClient(
  opts: { page?: PageState; extractValue?: unknown } = {},
): ClaudeChromeMcpClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async navigate(url) {
      calls.push({ method: 'navigate', args: [url] });
    },
    async click(sel) {
      calls.push({ method: 'click', args: [sel] });
    },
    async type(label, value) {
      calls.push({ method: 'type', args: [label, value] });
    },
    async screenshot(path) {
      calls.push({ method: 'screenshot', args: [path] });
    },
    async readPage() {
      calls.push({ method: 'readPage', args: [] });
      return opts.page ?? { url: 'http://localhost/', title: 'Home', text: 'hello' };
    },
    async act(instruction) {
      calls.push({ method: 'act', args: [instruction] });
    },
    async extract(instruction) {
      calls.push({ method: 'extract', args: [instruction] });
      return opts.extractValue ?? {};
    },
  };
}

const launchOpts: BrowserLaunchOptions = {
  headless: true,
  viewport: { width: 1280, height: 720 },
  timeout: 30_000,
};

describe('ClaudeChromeEngine', () => {
  it('is named "claude-chrome"', () => {
    const engine = new ClaudeChromeEngine(fakeMcpClient());
    expect(engine.name).toBe('claude-chrome');
  });

  it('maps deterministic BrowserSession methods onto the mcp client', async () => {
    const client = fakeMcpClient();
    const session = await new ClaudeChromeEngine(client).launch(launchOpts);

    await session.goto('https://example.com/login');
    await session.click('button', 'Sign in');
    await session.fill('Email', 'user@example.com');
    await session.screenshot('/tmp/shot.png');

    expect(client.calls).toEqual([
      { method: 'navigate', args: ['https://example.com/login'] },
      { method: 'click', args: [{ role: 'button', name: 'Sign in' }] },
      { method: 'type', args: ['Email', 'user@example.com'] },
      { method: 'screenshot', args: ['/tmp/shot.png'] },
    ]);
  });

  it('maps act onto the mcp client', async () => {
    const client = fakeMcpClient();
    const session = await new ClaudeChromeEngine(client).launch(launchOpts);
    await session.act('dismiss the cookie banner');
    expect(client.calls).toContainEqual({ method: 'act', args: ['dismiss the cookie banner'] });
  });

  it('returns the mcp client page state from readPage', async () => {
    const page: PageState = { url: 'http://localhost/dash', title: 'Dashboard', text: 'welcome' };
    const client = fakeMcpClient({ page });
    const session = await new ClaudeChromeEngine(client).launch(launchOpts);
    await expect(session.readPage()).resolves.toEqual(page);
    expect(client.calls).toContainEqual({ method: 'readPage', args: [] });
  });

  it('validates extract output against the provided zod schema', async () => {
    const client = fakeMcpClient({ extractValue: { total: 42 } });
    const session = await new ClaudeChromeEngine(client).launch(launchOpts);
    const value = await session.extract('read the cart total', z.object({ total: z.number() }));
    expect(value).toEqual({ total: 42 });
    expect(client.calls).toContainEqual({ method: 'extract', args: ['read the cart total'] });
  });

  it('throws when extract output does not match the schema', async () => {
    const client = fakeMcpClient({ extractValue: { total: 'not-a-number' } });
    const session = await new ClaudeChromeEngine(client).launch(launchOpts);
    await expect(
      session.extract('read the cart total', z.object({ total: z.number() })),
    ).rejects.toThrow();
  });
});
