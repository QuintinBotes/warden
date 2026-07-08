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

/** A single image input for multimodal generation. */
export interface ImagePart {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataBase64: string;
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
  /** Multimodal generation. Optional — providers without vision omit it, and the
   *  visual judge falls back to the pixel floor when it is absent. */
  generateWithImages?(
    prompt: string,
    images: ImagePart[],
    options?: GenerateOptions,
  ): Promise<string>;
}

/** A provider is constructed from the resolved `ai` config block. */
export type ProviderFactory = (cfg: WardenConfig['ai']) => LLMProvider;
