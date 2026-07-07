import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { createProvider } from './create-provider';
import { AnthropicProvider, type AnthropicLike } from './anthropic-provider';

const stubClient: AnthropicLike = {
  messages: {
    async create() {
      return { content: [] };
    },
  },
};

describe('createProvider', () => {
  it('returns an AnthropicProvider for provider "anthropic"', () => {
    const cfg = defineConfig({ ai: { provider: 'anthropic' } });
    const provider = createProvider(cfg.ai, { client: stubClient });
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
    const provider = createProvider(cfg.ai, { client: spyClient });
    const text = await provider.generateText('hi');
    expect(text).toBe('ok');
    expect(seenModel).toBe('claude-test');
  });

  it.each(['openai', 'gemini', 'ollama'] as const)(
    'throws ProviderError for the v2-only provider "%s"',
    (name) => {
      const cfg = defineConfig({ ai: { provider: name } });
      expect(() => createProvider(cfg.ai)).toThrowError(
        new RegExp(`Provider "${name}" is not available in v1`),
      );
      try {
        createProvider(cfg.ai);
      } catch (err) {
        expect(err).toMatchObject({ name: 'ProviderError', code: 'E_PROVIDER' });
      }
    },
  );
});
