import { describe, expect, it } from 'vitest';
import { BrowserError, defineConfig, type WardenConfig } from '@warden/core';
import { createEngine } from './create-engine';
import { PlaywrightEngine } from './playwright-engine';
import { ClaudeChromeEngine, type ClaudeChromeMcpClient } from './claude-chrome-engine';

function browserFor(engine: 'playwright' | 'claude-chrome' | 'stagehand'): WardenConfig['browser'] {
  return defineConfig({ browser: { engine } }).browser;
}

const noopClient: ClaudeChromeMcpClient = {
  async navigate() {},
  async click() {},
  async type() {},
  async screenshot() {},
  async readPage() {
    return { url: 'http://localhost/', title: '', text: '' };
  },
  async act() {},
  async extract() {
    return {};
  },
};

describe('createEngine', () => {
  it('returns a PlaywrightEngine named "playwright" for the playwright engine', () => {
    const engine = createEngine(browserFor('playwright'));
    expect(engine).toBeInstanceOf(PlaywrightEngine);
    expect(engine.name).toBe('playwright');
  });

  it('returns a ClaudeChromeEngine named "claude-chrome" when an mcpClient is injected', () => {
    const engine = createEngine(browserFor('claude-chrome'), { mcpClient: noopClient });
    expect(engine).toBeInstanceOf(ClaudeChromeEngine);
    expect(engine.name).toBe('claude-chrome');
  });

  it('throws a BrowserError for claude-chrome when no mcpClient is provided', () => {
    expect(() => createEngine(browserFor('claude-chrome'))).toThrow(BrowserError);
  });

  it('throws a BrowserError for the stagehand engine (v2)', () => {
    expect(() => createEngine(browserFor('stagehand'))).toThrow(BrowserError);
  });
});
