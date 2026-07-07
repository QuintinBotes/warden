import Anthropic from '@anthropic-ai/sdk';
import {
  ProviderError,
  type GenerateOptions,
  type LLMProvider,
  type Tool,
  type ToolCallResult,
} from '@warden/core';

/**
 * The Anthropic-shaped LLM provider (WS-11, V1 default). Every AI call in Warden goes
 * through {@link LLMProvider}; this implementation talks to Claude via the Anthropic SDK.
 *
 * The SDK client is injected so unit tests can drive a fake — the real network is never
 * touched in tests. See {@link AnthropicLike}.
 */

/**
 * The minimal slice of the Anthropic SDK that {@link AnthropicProvider} depends on.
 * Tests provide a stub implementing this interface so no real API call is made.
 */
export interface AnthropicLike {
  messages: {
    create(args: Record<string, unknown>): Promise<unknown>;
  };
}

/** The Anthropic tool wire format: `{ name, description, input_schema }`. */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Maps a Warden {@link Tool} to the Anthropic tool wire format. */
export function mapToAnthropicTool(tool: Tool): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

interface ContentBlockLike {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

function contentBlocks(response: unknown): ContentBlockLike[] {
  const content = (response as { content?: unknown } | null | undefined)?.content;
  return Array.isArray(content) ? (content as ContentBlockLike[]) : [];
}

function extractText(response: unknown): string {
  return contentBlocks(response)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

function extractToolCalls(response: unknown): { name: string; input: unknown }[] {
  return contentBlocks(response)
    .filter((block) => block.type === 'tool_use' && typeof block.name === 'string')
    .map((block) => ({ name: block.name as string, input: block.input }));
}

export interface AnthropicProviderDefaults {
  model: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly client: AnthropicLike,
    private readonly defaults: AnthropicProviderDefaults,
  ) {}

  async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
    const response = await this.call(this.baseArgs(prompt, options));
    return extractText(response);
  }

  async generateWithTools(
    prompt: string,
    tools: Tool[],
    options?: GenerateOptions,
  ): Promise<ToolCallResult> {
    const response = await this.call({
      ...this.baseArgs(prompt, options),
      tools: tools.map(mapToAnthropicTool),
    });
    const text = extractText(response);
    return {
      text: text.length > 0 ? text : undefined,
      toolCalls: extractToolCalls(response),
      raw: response,
    };
  }

  private baseArgs(prompt: string, options?: GenerateOptions): Record<string, unknown> {
    const args: Record<string, unknown> = {
      model: options?.model ?? this.defaults.model,
      max_tokens: options?.maxTokens ?? 8192,
      messages: [{ role: 'user', content: prompt }],
    };
    if (options?.temperature !== undefined) args.temperature = options.temperature;
    if (options?.systemPrompt !== undefined) args.system = options.systemPrompt;
    return args;
  }

  private async call(args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.messages.create(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Anthropic request failed: ${message}`);
    }
  }
}

/**
 * A lazily-constructed real Anthropic client. Construction (which reads
 * `ANTHROPIC_API_KEY`) is deferred to the first request so building a provider never
 * throws and unit tests — which always inject a client — never hit this path.
 */
export function defaultAnthropicClient(): AnthropicLike {
  let client: Anthropic | undefined;
  return {
    messages: {
      async create(args: Record<string, unknown>): Promise<unknown> {
        client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        return client.messages.create(args as never);
      },
    },
  };
}
