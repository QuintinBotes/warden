import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  ProviderError,
  type GenerateOptions,
  type LLMProvider,
  type Tool,
  type ToolCallResult,
} from '@warden/core';

/**
 * The Gemini-shaped {@link LLMProvider} (WS2-B, V2). Mirrors the Anthropic provider's
 * injectable-client pattern (see `../anthropic-provider.ts`) so unit tests never touch the
 * real Gemini API.
 */

/**
 * The minimal slice of the Gemini SDK that {@link GeminiProvider} depends on. Tests provide
 * a stub implementing this interface so no real API call is made. `args` mirrors the
 * `generateContent` request body; the resolved value mirrors the (already-unwrapped)
 * `GenerateContentResponse` shape.
 */
export interface GeminiLike {
  generateContent(args: Record<string, unknown>): Promise<unknown>;
}

/** The Gemini `tools` wire format: a single entry grouping all function declarations. */
export interface GeminiTools {
  functionDeclarations: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
}

/** Maps Warden {@link Tool}s to the Gemini `functionDeclarations` wire format. */
export function mapToGeminiTools(tools: Tool[]): GeminiTools[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    },
  ];
}

interface GeminiPartLike {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
}

interface GeminiCandidateLike {
  content?: { parts?: GeminiPartLike[] };
}

function parts(response: unknown): GeminiPartLike[] {
  const candidates = (response as { candidates?: GeminiCandidateLike[] } | null | undefined)
    ?.candidates;
  return (Array.isArray(candidates) ? candidates[0]?.content?.parts : undefined) ?? [];
}

function extractText(response: unknown): string {
  return parts(response)
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function extractToolCalls(response: unknown): { name: string; input: unknown }[] {
  return parts(response)
    .filter(
      (part): part is GeminiPartLike & { functionCall: { name: string; args?: unknown } } =>
        typeof part.functionCall?.name === 'string',
    )
    .map((part) => ({ name: part.functionCall.name, input: part.functionCall.args }));
}

export interface GeminiProviderDefaults {
  model: string;
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  constructor(
    private readonly client: GeminiLike,
    private readonly defaults: GeminiProviderDefaults,
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
      tools: mapToGeminiTools(tools),
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
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    if (options?.systemPrompt !== undefined) {
      args.systemInstruction = { parts: [{ text: options.systemPrompt }] };
    }
    const generationConfig: Record<string, unknown> = {};
    if (options?.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
    if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (Object.keys(generationConfig).length > 0) args.generationConfig = generationConfig;
    return args;
  }

  private async call(args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.generateContent(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Gemini request failed: ${message}`);
    }
  }
}

/**
 * A lazily-constructed real Gemini client. Construction (which reads `GEMINI_API_KEY`) is
 * deferred to the first request so building a provider never throws and unit tests — which
 * always inject a client — never hit this path.
 */
export function defaultGeminiClient(): GeminiLike {
  let client: GoogleGenerativeAI | undefined;
  return {
    async generateContent(args: Record<string, unknown>): Promise<unknown> {
      client ??= new GoogleGenerativeAI(
        process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '',
      );
      const { model, ...request } = args as { model: string; [key: string]: unknown };
      const generativeModel = client.getGenerativeModel({ model });
      const result = await generativeModel.generateContent(request as never);
      return result.response;
    },
  };
}
