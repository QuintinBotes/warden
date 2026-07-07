import { ProviderError, type LLMProvider, type WardenConfig } from '@warden/core';
import {
  AnthropicProvider,
  defaultAnthropicClient,
  type AnthropicLike,
} from './anthropic-provider';
import { OpenAIProvider, defaultOpenAIClient, type OpenAILike } from './providers/openai';
import { GeminiProvider, defaultGeminiClient, type GeminiLike } from './providers/gemini';
import { OllamaProvider, type FetchLike } from './providers/ollama';

/**
 * Constructs an {@link LLMProvider} from the resolved `ai` config block.
 *
 * V2 ships all four providers (WS2-B). Fake/injected clients can be supplied via `opts` so
 * unit tests never touch a real API or the network. If the resolved provider's API key is
 * missing (per `opts.env`, defaulting to `process.env`) and `ai.fallbackProvider` is set, the
 * fallback provider is constructed instead — the intended use is falling back to `ollama`,
 * which needs no key.
 */
export interface CreateProviderOptions {
  /** Injected Anthropic-shaped client (also used for the `anthropic` fallback target). */
  client?: AnthropicLike;
  /** Injected OpenAI-shaped client (also used for the `openai` fallback target). */
  openaiClient?: OpenAILike;
  /** Injected Gemini-shaped client (also used for the `gemini` fallback target). */
  geminiClient?: GeminiLike;
  /** Injected `fetch` implementation for the Ollama provider. */
  fetchImpl?: FetchLike;
  /** Environment to read API keys from when deciding whether to fall back. */
  env?: Record<string, string | undefined>;
}

type AiProviderName = WardenConfig['ai']['provider'];

/** Whether an API key is available for `provider`. Ollama never needs one. */
function hasApiKey(provider: AiProviderName, env: Record<string, string | undefined>): boolean {
  switch (provider) {
    case 'anthropic':
      return Boolean(env.ANTHROPIC_API_KEY);
    case 'openai':
      return Boolean(env.OPENAI_API_KEY);
    case 'gemini':
      return Boolean(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY);
    case 'ollama':
      return true;
    default:
      return false;
  }
}

/** Resolves `ai.provider`, falling back to `ai.fallbackProvider` when the primary key is missing. */
function resolveProviderName(
  ai: WardenConfig['ai'],
  env: Record<string, string | undefined>,
): AiProviderName {
  if (hasApiKey(ai.provider, env)) return ai.provider;
  if (ai.fallbackProvider) return ai.fallbackProvider;
  return ai.provider;
}

function buildProvider(
  provider: AiProviderName,
  ai: WardenConfig['ai'],
  opts: CreateProviderOptions,
): LLMProvider {
  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(opts.client ?? defaultAnthropicClient(), { model: ai.model });
    case 'openai':
      return new OpenAIProvider(opts.openaiClient ?? defaultOpenAIClient(), { model: ai.model });
    case 'gemini':
      return new GeminiProvider(opts.geminiClient ?? defaultGeminiClient(), { model: ai.model });
    case 'ollama':
      return new OllamaProvider(
        { model: ai.ollama.model, baseUrl: ai.ollama.baseUrl },
        opts.fetchImpl,
      );
    default:
      throw new ProviderError(`Unknown AI provider "${String(provider)}".`);
  }
}

export function createProvider(
  ai: WardenConfig['ai'],
  opts: CreateProviderOptions = {},
): LLMProvider {
  const env = opts.env ?? process.env;
  const resolved = resolveProviderName(ai, env);
  return buildProvider(resolved, ai, opts);
}
