import type { ZodType } from 'zod';
import type { BrowserEngine, BrowserLaunchOptions, BrowserSession, PageState } from '@warden/core';

/**
 * The Claude-Chrome engine — local-first, NOT the CI default.
 *
 * It drives a *running* Chrome instance through the Claude browser extension via an injected
 * {@link ClaudeChromeMcpClient}. Using it requires a live Chrome with the Claude extension
 * installed and the target site granted permission, so it is intended for local, interactive
 * runs rather than headless CI. In CI, prefer the `playwright` engine.
 *
 * The client is always injected (constructor arg), which keeps this engine hermetically
 * unit-testable against a fake MCP client that records calls.
 */

/**
 * The minimal MCP surface the Claude-Chrome engine needs. A concrete implementation talks to the
 * Claude-in-Chrome MCP server; unit tests supply a fake that records calls.
 */
export interface ClaudeChromeMcpClient {
  navigate(url: string): Promise<void>;
  click(sel: { role?: string; name?: string }): Promise<void>;
  type(label: string, value: string): Promise<void>;
  screenshot(path: string): Promise<void>;
  readPage(): Promise<PageState>;
  act(instruction: string): Promise<void>;
  extract(instruction: string): Promise<unknown>;
}

export class ClaudeChromeEngine implements BrowserEngine {
  readonly name = 'claude-chrome' as const;

  constructor(private readonly client: ClaudeChromeMcpClient) {}

  async launch(_opts: BrowserLaunchOptions): Promise<BrowserSession> {
    const client = this.client;
    return {
      async goto(url) {
        await client.navigate(url);
      },
      async click(role, name) {
        await client.click({ role, name });
      },
      async fill(label, value) {
        await client.type(label, value);
      },
      async act(instruction) {
        await client.act(instruction);
      },
      async extract<T>(instruction: string, schema: ZodType<T>): Promise<T> {
        // The extension returns opaque JSON; validate it against the caller's schema so downstream
        // code gets a typed, checked value rather than trusting the model's shape.
        return schema.parse(await client.extract(instruction));
      },
      async screenshot(path) {
        await client.screenshot(path);
      },
      async readPage() {
        return client.readPage();
      },
      async setViewport() {
        // The Claude-in-Chrome extension controls the user's real browser window; programmatic
        // viewport resizing is out of scope for the minimal MCP surface, so this is a no-op.
      },
      async close() {
        // The extension owns the Chrome session lifecycle; nothing for the engine to tear down.
      },
    };
  }
}
