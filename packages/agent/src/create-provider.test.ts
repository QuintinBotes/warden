import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { createProvider } from './create-provider';
import { AnthropicProvider, type AnthropicLike } from './anthropic-provider';
import { OpenAIProvider, type OpenAILike } from './providers/openai';
import { GeminiProvider, type GeminiLike } from './providers/gemini';
import { OllamaProvider, type FetchLike } from './providers/ollama';

const stubClient: AnthropicLike = {
  messages: {
    async create() {
      return { content: [] };
    },
  },
};

const stubOpenAIClient: OpenAILike = {
  chat: {
    completions: {
      async create() {
        return { choices: [{ message: { content: '' } }] };
      },
    },
  },
};

const stubGeminiClient: GeminiLike = {
  async generateContent() {
    return { candidates: [] };
  },
};

const stubFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  async json() {
    return { response: '' };
  },
});

describe('createProvider', () => {
  it('returns an AnthropicProvider for provider "anthropic"', () => {
    const cfg = defineConfig({ ai: { provider: 'anthropic' } });
    const provider = createProvider(cfg.ai, {
      client: stubClient,
      env: { ANTHROPIC_API_KEY: 'k' },
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('uses the injected client (no real API construction)', async () => {
    const cfg = defineConfig({ ai: { provider: 'anthropic', model: 'claude-test' } });
    let seenModel: unknown;
    const spyClient: AnthropicLike = {
      messages: {
        async create(args) {
          seenModel = args.model;
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
    };
    const provider = createProvider(cfg.ai, { client: spyClient, env: { ANTHROPIC_API_KEY: 'k' } });
    const text = await provider.generateText('hi');
    expect(text).toBe('ok');
    expect(seenModel).toBe('claude-test');
  });

  it('returns an OpenAIProvider for provider "openai" when OPENAI_API_KEY is present', () => {
    const cfg = defineConfig({ ai: { provider: 'openai' } });
    const provider = createProvider(cfg.ai, {
      openaiClient: stubOpenAIClient,
      env: { OPENAI_API_KEY: 'k' },
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('returns a GeminiProvider for provider "gemini" when GEMINI_API_KEY is present', () => {
    const cfg = defineConfig({ ai: { provider: 'gemini' } });
    const provider = createProvider(cfg.ai, {
      geminiClient: stubGeminiClient,
      env: { GEMINI_API_KEY: 'k' },
    });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe('gemini');
  });

  it('returns an OllamaProvider for provider "ollama"', () => {
    const cfg = defineConfig({ ai: { provider: 'ollama' } });
    const provider = createProvider(cfg.ai, { fetchImpl: stubFetch, env: {} });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
  });

  it('falls back to ollama when the primary provider key is missing and fallbackProvider is set', () => {
    const cfg = defineConfig({ ai: { provider: 'openai', fallbackProvider: 'ollama' } });
    const provider = createProvider(cfg.ai, {
      openaiClient: stubOpenAIClient,
      fetchImpl: stubFetch,
      env: {},
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
  });

  it('does not fall back when the primary provider key is present even if a fallback is configured', () => {
    const cfg = defineConfig({ ai: { provider: 'openai', fallbackProvider: 'ollama' } });
    const provider = createProvider(cfg.ai, {
      openaiClient: stubOpenAIClient,
      fetchImpl: stubFetch,
      env: { OPENAI_API_KEY: 'k' },
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it('does not fall back when no fallbackProvider is configured, even without a key', () => {
    const cfg = defineConfig({ ai: { provider: 'openai' } });
    const provider = createProvider(cfg.ai, { openaiClient: stubOpenAIClient, env: {} });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });
});
