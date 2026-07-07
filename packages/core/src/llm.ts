import type { WardenConfig } from './config';

/**
 * LLM provider abstraction — the seam that lets Warden swap Claude for GPT-4o, Gemini,
 * or a local Ollama model without touching agent logic. V1 ships the Anthropic provider
 * (WS-11); v2 registers the rest.
 */

export interface GenerateOptions {
  model?: string; // e.g. 'claude-opus-4-5', 'gpt-4o'
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  text?: string;
  toolCalls: { name: string; input: unknown }[];
  raw: unknown;
}

export interface LLMProvider {
  name: string;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  generateWithTools(
    prompt: string,
    tools: Tool[],
    options?: GenerateOptions,
  ): Promise<ToolCallResult>;
  streamText?(prompt: string): AsyncIterable<string>;
}

/** A provider is constructed from the resolved `ai` config block. */
export type ProviderFactory = (cfg: WardenConfig['ai']) => LLMProvider;
