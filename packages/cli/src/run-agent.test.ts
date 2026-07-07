import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { fakeBrowserSession, fakeProvider } from '@warden/core/testing';
import { runAgent } from './run-agent';

describe('runAgent', () => {
  let dir: string;
  let outputFile: string;
  let originalApiKey: string | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-agent-'));
    outputFile = path.join(dir, 'agent-report.json');
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it('runs the healer strategy with a fake provider when ANTHROPIC_API_KEY is unset, and writes the AgentOutput JSON', async () => {
    const result = await runAgent(
      { strategy: 'healer', output: outputFile, cwd: dir },
      {
        config: defineConfig(),
        failure: { testCode: 'expect(1).toBe(1)', errorMessage: 'selector not found' },
      },
    );

    expect(result.diagnosis).toBeDefined();
    expect(result.markdownReport).toContain('Healer Diagnosis');

    const written = JSON.parse(await fs.readFile(outputFile, 'utf-8'));
    expect(written).toEqual(result);
  });

  it('runs the exploratory strategy against an injected fake browser + fake provider', async () => {
    const browser = fakeBrowserSession({ page: { url: '/', title: 'Home', text: 'Welcome' } });
    const provider = fakeProvider({ text: 'looks fine' });

    const result = await runAgent(
      { strategy: 'exploratory', url: 'https://example.test', output: outputFile, cwd: dir },
      { config: defineConfig(), browser, provider },
    );

    expect(result.markdownReport).toContain('Exploratory QA Report');
    expect(browser.actions.length).toBeGreaterThan(0);
    const written = JSON.parse(await fs.readFile(outputFile, 'utf-8'));
    expect(written.findings).toEqual(result.findings);
  });

  it('uses an injected provider even when ANTHROPIC_API_KEY is set (no real network call)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    const provider = fakeProvider();

    const result = await runAgent(
      { strategy: 'healer', output: outputFile, cwd: dir },
      {
        config: defineConfig(),
        provider,
        failure: { testCode: 'x', errorMessage: 'timeout waiting for selector' },
      },
    );

    expect(result.diagnosis).toBeDefined();
  });

  it('writes generatedFiles for the generative strategy', async () => {
    const provider = fakeProvider({ text: 'export const test = 1;' });

    const result = await runAgent(
      { strategy: 'generative', output: outputFile, cwd: dir },
      { config: defineConfig(), provider },
    );

    expect(result.generatedFiles).toHaveLength(1);
    const written = JSON.parse(await fs.readFile(outputFile, 'utf-8'));
    expect(written.generatedFiles).toEqual(result.generatedFiles);
  });
});
