import { describe, expect, it } from 'vitest';
import { BrowserError, defineConfig, type BrowserEngine } from '@warden/core';
import { createVisualEngine } from './create-visual-engine.js';

const visual = defineConfig({ visual: { enabled: true } }).visual;

const engineNamed = (name: BrowserEngine['name']): BrowserEngine => ({
  name,
  async launch() {
    throw new Error('not launched in this test');
  },
});

describe('createVisualEngine', () => {
  it('wraps the playwright engine into a deterministic visual engine', () => {
    const visualEngine = createVisualEngine(engineNamed('playwright'), visual);
    expect(visualEngine.name).toBe('playwright-visual');
  });

  it('rejects unsupported browser engines', () => {
    expect(() => createVisualEngine(engineNamed('claude-chrome'), visual)).toThrow(BrowserError);
    expect(() => createVisualEngine(engineNamed('stagehand'), visual)).toThrow(/playwright/);
  });
});
