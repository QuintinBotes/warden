import OpenAI from 'openai';
import {
  ProviderError,
  type GenerateOptions,
  type LLMProvider,
  type Tool,
  type ToolCallResult,
} from '@warden/core';

/**
 * The OpenAI-shaped {@link LLMProvider} (WS2-B, V2). Mirrors the Anthropic provider's
 * injectable-client pattern (see `../anthropic-provider.ts`) so unit tests never touch the
 * real OpenAI API.
 */

/**
 * The minimal slice of the OpenAI SDK that {@link OpenAIProvider} depends on. Tests provide
 * a stub implementing this interface so no real API call is made.
 */
export interface OpenAILike {
  chat: {
    completions: {
      create(args: Record<string, unknown>): Promise<unknown>;
    };
  };
}

/** The OpenAI tool wire format: `{ type: "function", function: { name, description, parameters } }`. */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Maps a Warden {@link Tool} to the OpenAI function-tool wire format. */
export function mapToOpenAITool(tool: Tool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

interface OpenAIToolCallLike {
  function?: { name?: string; arguments?: string };
}

interface OpenAIMessageLike {
  content?: string | null;
  tool_calls?: OpenAIToolCallLike[];
}

function messageOf(response: unknown): OpenAIMessageLike {
  const choices = (response as { choices?: { message?: OpenAIMessageLike }[] } | null | undefined)
    ?.choices;
  return (Array.isArray(choices) ? choices[0]?.message : undefined) ?? {};
}

function extractText(response: unknown): string {
  const content = messageOf(response).content;
  return typeof content === 'string' ? content : '';
}

function extractToolCalls(response: unknown): { name: string; input: unknown }[] {
  const toolCalls = messageOf(response).tool_calls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .filter(
      (call): call is OpenAIToolCallLike & { function: { name: string } } =>
        typeof call.function?.name === 'string',
    )
    .map((call) => {
      let input: unknown = {};
      const rawArgs = call.function.arguments;
      if (typeof rawArgs === 'string' && rawArgs.length > 0) {
        try {
          input = JSON.parse(rawArgs);
        } catch {
          input = rawArgs;
        }
      }
      return { name: call.function.name, input };
    });
}

export interface OpenAIProviderDefaults {
  model: string;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  constructor(
    private readonly client: OpenAILike,
    private readonly defaults: OpenAIProviderDefaults,
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
      tools: tools.map(mapToOpenAITool),
    });
    const text = extractText(response);
    return {
      text: text.length > 0 ? text : undefined,
      toolCalls: extractToolCalls(response),
      raw: response,
    };
  }

  private baseArgs(prompt: string, options?: GenerateOptions): Record<string, unknown> {
    const messages: Record<string, unknown>[] = [];
    if (options?.systemPrompt !== undefined) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const args: Record<string, unknown> = {
      model: options?.model ?? this.defaults.model,
      messages,
    };
    if (options?.maxTokens !== undefined) args.max_tokens = options.maxTokens;
    if (options?.temperature !== undefined) args.temperature = options.temperature;
    return args;
  }

  private async call(args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.chat.completions.create(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`OpenAI request failed: ${message}`);
    }
  }
}

/**
 * A lazily-constructed real OpenAI client. Construction (which reads `OPENAI_API_KEY`) is
 * deferred to the first request so building a provider never throws and unit tests — which
 * always inject a client — never hit this path.
 */
export function defaultOpenAIClient(): OpenAILike {
  let client: OpenAI | undefined;
  return {
    chat: {
      completions: {
        async create(args: Record<string, unknown>): Promise<unknown> {
          client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          return client.chat.completions.create(args as never);
        },
      },
    },
  };
}
