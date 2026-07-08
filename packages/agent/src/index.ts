/**
 * `@warden/agent` (WS-11) — the LLM provider abstraction and the three V1 agent strategies
 * (exploratory, generative, healer). Everything here is built against the `@warden/core`
 * contract surface and is fully injectable so it can be unit-tested without a real LLM,
 * browser, or network.
 */

// Provider abstraction
export {
  AnthropicProvider,
  defaultAnthropicClient,
  mapToAnthropicTool,
  type AnthropicLike,
  type AnthropicTool,
  type AnthropicProviderDefaults,
} from './anthropic-provider';
export { createProvider, type CreateProviderOptions } from './create-provider';
export {
  OpenAIProvider,
  defaultOpenAIClient,
  mapToOpenAITool,
  type OpenAILike,
  type OpenAITool,
  type OpenAIProviderDefaults,
} from './providers/openai';
export {
  GeminiProvider,
  defaultGeminiClient,
  mapToGeminiTools,
  type GeminiLike,
  type GeminiTools,
  type GeminiProviderDefaults,
} from './providers/gemini';
export {
  OllamaProvider,
  buildOllamaPrompt,
  parseOllamaToolCalls,
  type FetchLike,
  type OllamaProviderDefaults,
} from './providers/ollama';

// Strategies
export { createStrategy } from './create-strategy';
export { ExploratoryStrategy } from './exploratory-strategy';
export { GenerativeStrategy } from './generative-strategy';
export { HealerStrategy } from './healer-strategy';

// System prompts
export {
  EXPLORATORY_SYSTEM_PROMPT,
  GENERATIVE_SYSTEM_PROMPT,
  HEALER_SYSTEM_PROMPT,
  FLAKE_CLASSIFIER_SYSTEM_PROMPT,
} from './prompts';

// Flake root-cause classifier
export { createFlakeClassifier, heuristicRootCause } from './flake-classifier';

// Cross-repo coverage sync — the add/update/remove recommendation engine
export {
  createCoverageRecommender,
  COVERAGE_TEST_SYSTEM_PROMPT,
  COVERAGE_DOC_SYSTEM_PROMPT,
  type CoverageGapInput,
} from './coverage-recommender';
