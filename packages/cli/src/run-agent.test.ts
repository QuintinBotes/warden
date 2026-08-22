import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defineConfig,
  ProviderError,
  type AgentInput,
  type AgentStrategy,
  type ExploratoryFinding,
  type QAPlatformPlugin,
  type WardenConfig,
} from '@warden/core';
import type { OpenAILike } from '@warden/agent';
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

  it('hands the strategy the provider and model the caller overrode, not the ones in the config', async () => {
    // CI passes these through as flags because it cannot edit the repo's warden.config.*; if the
    // override were dropped the run would silently use the configured provider instead.
    let seen: WardenConfig | undefined;
    const strategy: AgentStrategy = {
      name: 'healer',
      run: async (input) => {
        seen = input.config;
        return { markdownReport: 'ok', findings: [] };
      },
    };

    await runAgent(
      {
        strategy: 'healer',
        output: outputFile,
        cwd: dir,
        provider: 'ollama',
        model: 'qwen3:32b',
      },
      {
        config: defineConfig({ ai: { provider: 'anthropic', model: 'claude-sonnet-5' } }),
        strategy,
      },
    );

    expect(seen?.ai.provider).toBe('ollama');
    expect(seen?.ai.model).toBe('qwen3:32b');
  });

  it('refuses a provider name it does not know rather than quietly falling back to the configured one', async () => {
    await expect(
      runAgent(
        { strategy: 'healer', output: outputFile, cwd: dir, provider: 'gpt5-turbo' },
        {
          config: defineConfig(),
          failure: { testCode: 'expect(1).toBe(1)', errorMessage: 'selector not found' },
        },
      ),
    ).rejects.toThrow(/Unknown AI provider "gpt5-turbo"/);
  });

  // Was 'runs ... with a fake provider when ANTHROPIC_API_KEY is unset'. Running keyless was the
  // defect, not the contract; what this still has to prove is the healer path and the JSON write.
  it('runs the healer strategy with an injected provider, and writes the AgentOutput JSON', async () => {
    const result = await runAgent(
      { strategy: 'healer', output: outputFile, cwd: dir },
      {
        config: defineConfig(),
        provider: fakeProvider(),
        failure: { testCode: 'expect(1).toBe(1)', errorMessage: 'selector not found' },
      },
    );

    expect(result.diagnosis).toBeDefined();
    expect(result.markdownReport).toContain('Healer Diagnosis');

    const written = JSON.parse(await fs.readFile(outputFile, 'utf-8'));
    expect(written).toEqual(result);
  });

  it('overrides ai.provider and ai.model for this run, and refuses a provider it cannot build', async () => {
    const seen: { provider: string; model: string }[] = [];
    const result = await runAgent(
      {
        strategy: 'healer',
        output: outputFile,
        cwd: dir,
        provider: 'ollama',
        model: 'qwen3:32b',
      },
      {
        config: defineConfig(),
        provider: fakeProvider({ text: 'ok' }),
        strategy: {
          name: 'healer',
          async run(input) {
            seen.push({ provider: input.config.ai.provider, model: input.config.ai.model });
            return { findings: [], markdownReport: 'ran' };
          },
        },
        failure: { testCode: 'x', errorMessage: 'y' },
      },
    );

    expect(result.markdownReport).toBe('ran');
    expect(seen).toEqual([{ provider: 'ollama', model: 'qwen3:32b' }]);

    // A name no provider can be built from is an error, not a silent fall-through to the
    // configured provider: a run must not report as the model that was asked for when it wasn't.
    await expect(
      runAgent(
        { strategy: 'healer', output: outputFile, cwd: dir, provider: 'clyde' },
        { config: defineConfig(), failure: { testCode: 'x', errorMessage: 'y' } },
      ),
    ).rejects.toThrow(/Unknown AI provider "clyde"/);
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

  it('runs the provider and model named on the command line, not the ones in the config', async () => {
    // The GitHub Action passes `--provider`/`--model` through to this command; whatever the
    // repo's warden.config.ts says, the run has to use the pair the caller named.
    let seen: AgentInput | undefined;
    const strategy: AgentStrategy = {
      name: 'generative',
      run(input) {
        seen = input;
        return Promise.resolve({ findings: [], markdownReport: '# none' });
      },
    };

    await runAgent(
      {
        strategy: 'generative',
        output: outputFile,
        cwd: dir,
        provider: 'ollama',
        model: 'qwen3:32b',
      },
      {
        config: defineConfig({ ai: { provider: 'anthropic', model: 'claude-sonnet-5' } }),
        strategy,
      },
    );

    expect(seen?.config.ai.provider).toBe('ollama');
    expect(seen?.config.ai.model).toBe('qwen3:32b');
  });

  it('leaves the configured provider alone when no override is passed', async () => {
    let seen: AgentInput | undefined;
    const strategy: AgentStrategy = {
      name: 'generative',
      run(input) {
        seen = input;
        return Promise.resolve({ findings: [], markdownReport: '# none' });
      },
    };

    await runAgent(
      { strategy: 'generative', output: outputFile, cwd: dir },
      // A provider is injected because the credential check now runs for real ones; this test
      // is about the `ai` block the strategy sees, not about how the provider was built.
      {
        config: defineConfig({ ai: { provider: 'openai', model: 'gpt-5' } }),
        strategy,
        provider: fakeProvider(),
      },
    );

    expect(seen?.config.ai.provider).toBe('openai');
    expect(seen?.config.ai.model).toBe('gpt-5');
  });

  it('refuses an unknown --provider by name instead of silently running another one', async () => {
    await expect(
      runAgent(
        { strategy: 'generative', output: outputFile, cwd: dir, provider: 'claude-code' },
        { config: defineConfig(), provider: fakeProvider() },
      ),
    ).rejects.toThrow(/claude-code/);
  });

  it('fires onBugFound on every configured plugin, once per finding', async () => {
    const browser = fakeBrowserSession({ page: { url: '/', title: 'Home', text: 'Welcome' } });
    const provider = fakeProvider({
      toolCalls: [
        {
          name: 'report_finding',
          input: {
            title: 'Payment fails for Visa 4242',
            severity: 'CRITICAL',
            steps: ['Add to cart', 'Checkout'],
            expected: 'Payment confirmed',
            actual: 'Error processing payment',
          },
        },
      ],
    });
    const seen: ExploratoryFinding[] = [];
    const plugin: QAPlatformPlugin = {
      name: 'recorder',
      async onBugFound(bug) {
        seen.push(bug);
      },
    };

    const result = await runAgent(
      { strategy: 'exploratory', url: 'https://example.test', output: outputFile, cwd: dir },
      { config: defineConfig({ plugins: [plugin] }), browser, provider },
    );

    expect(result.findings).toHaveLength(1);
    expect(seen).toEqual(result.findings);
  });
});

describe('runAgent provider selection', () => {
  let dir: string;
  let outputFile: string;
  const savedEnv: Record<string, string | undefined> = {};
  const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-agent-provider-'));
    outputFile = path.join(dir, 'agent-report.json');
    for (const k of keys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    for (const k of keys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('refuses to run, and writes no report, when no provider credentials are available', async () => {
    await expect(
      runAgent(
        { strategy: 'generative', output: outputFile, cwd: dir },
        { config: defineConfig({ ai: { provider: 'anthropic' } }) },
      ),
    ).rejects.toThrow(ProviderError);

    await expect(fs.access(outputFile)).rejects.toThrow();
  });

  it('refuses before it launches a browser, so an uncredentialed exploratory run starts nothing', async () => {
    // `claude-chrome` with no injected mcpClient makes createEngine throw. Getting ProviderError
    // rather than BrowserError is the proof that the credential check ran first.
    await expect(
      runAgent(
        { strategy: 'exploratory', url: 'https://example.test', output: outputFile, cwd: dir },
        {
          config: defineConfig({
            ai: { provider: 'anthropic' },
            browser: { engine: 'claude-chrome' },
          }),
        },
      ),
    ).rejects.toThrow(ProviderError);
  });

  it('builds the provider the config names — not the stub — when that provider is credentialed', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-not-real';
    const openaiClient: OpenAILike = {
      chat: {
        completions: {
          async create() {
            return { choices: [{ message: { content: 'await page.goto("/");' } }] };
          },
        },
      },
    };

    const result = await runAgent(
      { strategy: 'generative', output: outputFile, cwd: dir },
      {
        config: defineConfig({ ai: { provider: 'openai', model: 'gpt-4o' } }),
        providerOptions: { openaiClient },
      },
    );

    expect(result.provider).toBe('openai');
    expect(result.generatedFiles?.[0]?.content).toContain('page.goto');
    expect(result.generatedFiles?.[0]?.content).not.toContain('FAKE_RESPONSE');
  });

  it('records which provider produced a report, so a stub run is not mistaken for a real one', async () => {
    const result = await runAgent(
      { strategy: 'generative', output: outputFile, cwd: dir },
      { config: defineConfig(), provider: fakeProvider({ text: 'x' }) },
    );

    expect(result.provider).toBe('fake');
    const written = JSON.parse(await fs.readFile(outputFile, 'utf-8'));
    expect(written.provider).toBe('fake');
  });

  it('runs the stub only when it is asked for explicitly, and says so in the report', async () => {
    const result = await runAgent(
      { strategy: 'generative', output: outputFile, cwd: dir, stubProvider: true },
      { config: defineConfig({ ai: { provider: 'anthropic' } }) },
    );

    expect(result.provider).toBe('stub');
    expect(result.markdownReport).toContain('no model was called');
  });
});
