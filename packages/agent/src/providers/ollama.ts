import {
  ProviderError,
  type GenerateOptions,
  type LLMProvider,
  type Tool,
  type ToolCallResult,
} from '@warden/core';

/**
 * The Ollama-shaped {@link LLMProvider} (WS2-B, V2) — a local-model fallback that needs no
 * API key. Unlike the SDK-backed providers, there is no client library to inject; instead
 * the `fetch` implementation itself is injected so unit tests never touch the real network.
 */

/** The subset of the global `fetch` signature {@link OllamaProvider} depends on. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

interface OllamaGenerateResponse {
  response?: string;
}

/** Marker embedded in the prompt/response envelope for a tool-calling turn. */
interface ParsedToolCallEnvelope {
  toolCalls?: { name?: unknown; input?: unknown }[];
}

/**
 * Ollama's `/api/generate` endpoint has no native tool-calling support, so the tool
 * definitions are embedded in the prompt and the model is asked to reply with a JSON
 * envelope when it wants to call one.
 */
export function buildOllamaPrompt(prompt: string, tools: Tool[]): string {
  if (tools.length === 0) return prompt;
  const toolDocs = tools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description}\n  inputSchema: ${JSON.stringify(tool.inputSchema)}`,
    )
    .join('\n');
  return [
    prompt,
    '',
    'You may call one of the following tools. If you do, respond with ONLY a JSON object of ' +
      'the form {"toolCalls":[{"name":"<tool name>","input":<tool input>}]} and nothing else. ' +
      'Otherwise, answer normally in plain text.',
    toolDocs,
  ].join('\n');
}

/** Best-effort parse of a tool-call JSON envelope from a plain-text Ollama response. */
export function parseOllamaToolCalls(text: string): { name: string; input: unknown }[] | undefined {
  let parsed: ParsedToolCallEnvelope;
  try {
    parsed = JSON.parse(text) as ParsedToolCallEnvelope;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed.toolCalls)) return undefined;
  return parsed.toolCalls
    .filter((call): call is { name: string; input: unknown } => typeof call.name === 'string')
    .map((call) => ({ name: call.name, input: call.input }));
}

export interface OllamaProviderDefaults {
  model: string;
  baseUrl: string;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  constructor(
    private readonly defaults: OllamaProviderDefaults,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
    const response = await this.call(prompt, options);
    return response.response ?? '';
  }

  async generateWithTools(
    prompt: string,
    tools: Tool[],
    options?: GenerateOptions,
  ): Promise<ToolCallResult> {
    const response = await this.call(buildOllamaPrompt(prompt, tools), options);
    const text = response.response ?? '';
    const toolCalls = parseOllamaToolCalls(text);
    return {
      text: toolCalls === undefined && text.length > 0 ? text : undefined,
      toolCalls: toolCalls ?? [],
      raw: response,
    };
  }

  private async call(prompt: string, options?: GenerateOptions): Promise<OllamaGenerateResponse> {
    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaults.model,
      prompt,
      stream: false,
    };
    if (options?.systemPrompt !== undefined) body.system = options.systemPrompt;
    const ollamaOptions: Record<string, unknown> = {};
    if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
    if (options?.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;
    if (Object.keys(ollamaOptions).length > 0) body.options = ollamaOptions;

    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(`${this.defaults.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(`Ollama request failed: ${message}`);
    }
    if (!res.ok) {
      throw new ProviderError(`Ollama request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as OllamaGenerateResponse;
  }
}
