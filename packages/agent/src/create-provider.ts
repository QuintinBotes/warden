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

/**
 * The environment variables that credential each provider, in the order a message should
 * name them. Ollama's empty list is the honest answer rather than a special case: it talks to
 * a local daemon and there is no key to be missing.
 */
const CREDENTIAL_ENV_VARS: Record<AiProviderName, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  ollama: [],
};

/** Whether an API key is available for `provider`. Ollama never needs one. */
function hasApiKey(provider: AiProviderName, env: Record<string, string | undefined>): boolean {
  // The `?? []` stands in for the old `default:` arm: a provider name from outside the enum is
  // uncredentialable, not credential-free, so an unknown name must answer false rather than true.
  const vars = CREDENTIAL_ENV_VARS[provider] as readonly string[] | undefined;
  if (vars === undefined) return false;
  return vars.length === 0 || vars.some((name) => Boolean(env[name]));
}

/**
 * Whether `opts` already carries a client for `provider`, in which case no credential is
 * needed: the caller supplied the thing the key would have been used to build. Ollama is
 * always true because it has nothing to credential.
 */
function hasInjectedClient(provider: AiProviderName, opts: CreateProviderOptions): boolean {
  switch (provider) {
    case 'anthropic':
      return opts.client !== undefined;
    case 'openai':
      return opts.openaiClient !== undefined;
    case 'gemini':
      return opts.geminiClient !== undefined;
    case 'ollama':
      return true;
    default:
      return false;
  }
}

/**
 * The refusal message. It names the variable to set, says why no stub was substituted, and
 * points at the one provider that runs without a key — so the reader is never left with
 * "not configured" and no next step.
 */
function missingCredentialsMessage(resolved: AiProviderName, ai: WardenConfig['ai']): string {
  const vars = CREDENTIAL_ENV_VARS[resolved] ?? [];
  const named = vars.join(' or ');
  const via =
    resolved === ai.provider
      ? `AI provider "${resolved}"`
      : `AI provider "${resolved}" (reached via ai.fallbackProvider from "${ai.provider}")`;
  return (
    `No credentials for ${via}: set ${named}. ` +
    'Warden will not substitute a stub provider, because a report written without a model ' +
    'reads exactly like a clean pass. To run without an API key, set ai.provider (or ' +
    'ai.fallbackProvider) to "ollama", which runs against a local daemon.'
  );
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

/**
 * Throws when the provider that survives resolution has no credentials and no injected client,
 * rather than returning something that cannot reach a model. Construction of the real SDK
 * clients is lazy, so without this check the first sign of a missing key is a request failure
 * deep inside a strategy — by which point a caller has already been tempted to swallow it and
 * carry on with a stub. An agent report produced without a model is indistinguishable from a
 * clean one, so the refusal has to happen here, before any work starts.
 */
export function createProvider(
  ai: WardenConfig['ai'],
  opts: CreateProviderOptions = {},
): LLMProvider {
  const env = opts.env ?? process.env;
  const resolved = resolveProviderName(ai, env);
  if (!hasApiKey(resolved, env) && !hasInjectedClient(resolved, opts)) {
    throw new ProviderError(missingCredentialsMessage(resolved, ai));
  }
  return buildProvider(resolved, ai, opts);
}
