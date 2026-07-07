import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, loadConfig } from './config';

describe('defineConfig', () => {
  it('fills documented defaults from an empty config', () => {
    const cfg = defineConfig({});
    expect(cfg.ai.provider).toBe('anthropic');
    expect(cfg.browser.engine).toBe('playwright');
    expect(cfg.browser.headless).toBe(true);
    expect(cfg.gates.blockOnPassRateBelowPercent).toBe(90);
    expect(cfg.gates.flakeQuarantineAfterRuns).toBe(3);
    expect(cfg.reporting.ctrf).toBe(true);
    expect(cfg.testManagement.testCasesDir).toBe('tests/cases/');
    expect(cfg.scope.sharedPaths).toContain('packages/core/');
    expect(cfg.plugins).toEqual([]);
  });

  it('merges overrides while keeping every other default', () => {
    const cfg = defineConfig({ ai: { provider: 'ollama' }, browser: { headless: false } });
    expect(cfg.ai.provider).toBe('ollama');
    expect(cfg.ai.ollama.baseUrl).toBe('http://localhost:11434');
    expect(cfg.browser.headless).toBe(false);
    expect(cfg.browser.engine).toBe('playwright');
  });

  it('rejects an unknown provider', () => {
    // @ts-expect-error — 'bard' is not a valid provider
    expect(() => defineConfig({ ai: { provider: 'bard' } })).toThrow();
  });
});

describe('loadConfig', () => {
  it('resolves a warden.config.ts and applies defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'warden-cfg-'));
    try {
      await writeFile(
        join(dir, 'warden.config.ts'),
        'export default { browser: { headless: false }, gates: { blockOnPassRateBelowPercent: 80 } };\n',
      );
      const cfg = await loadConfig(dir);
      expect(cfg.browser.headless).toBe(false);
      expect(cfg.gates.blockOnPassRateBelowPercent).toBe(80);
      expect(cfg.ai.provider).toBe('anthropic'); // default still applied
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
