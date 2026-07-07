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
export { createProvider } from './create-provider';

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
} from './prompts';
