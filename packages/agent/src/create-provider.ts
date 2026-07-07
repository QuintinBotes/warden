import { ProviderError, type LLMProvider, type WardenConfig } from '@warden/core';
import {
  AnthropicProvider,
  defaultAnthropicClient,
  type AnthropicLike,
} from './anthropic-provider';

/**
 * Constructs an {@link LLMProvider} from the resolved `ai` config block.
 *
 * V1 only ships the Anthropic provider; the other providers are recognised by the config
 * schema but throw a helpful {@link ProviderError} until they land in v2. A fake client can
 * be injected via `opts.client` so unit tests never touch the real API.
 */
export function createProvider(
  ai: WardenConfig['ai'],
  opts: { client?: AnthropicLike } = {},
): LLMProvider {
  switch (ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(opts.client ?? defaultAnthropicClient(), { model: ai.model });
    case 'openai':
    case 'gemini':
    case 'ollama':
      throw new ProviderError(
        `Provider "${ai.provider}" is not available in v1; it ships in v2. Use provider "anthropic".`,
      );
    default:
      throw new ProviderError(`Unknown AI provider "${String(ai.provider)}".`);
  }
}
