import { describe, it, expect } from 'vitest';
import type { Tool } from '@warden/core';
import { OllamaProvider, buildOllamaPrompt, parseOllamaToolCalls, type FetchLike } from './ollama';

function fakeFetch(jsonResponse: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const calls: { url: string; init?: Record<string, unknown> }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      statusText: 'OK',
      async json() {
        return jsonResponse;
      },
    };
  };
  return { fetchImpl, calls };
}

describe('OllamaProvider', () => {
  it('exposes name "ollama"', () => {
    const { fetchImpl } = fakeFetch({ response: '' });
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    expect(provider.name).toBe('ollama');
  });

  it('generateText POSTs to <baseUrl>/api/generate and returns the response text', async () => {
    const { fetchImpl, calls } = fakeFetch({ response: 'hello there' });
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    const text = await provider.generateText('hi');
    expect(text).toBe('hello there');
    expect(calls[0]!.url).toBe('http://localhost:11434/api/generate');
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toMatchObject({ model: 'llama3', prompt: 'hi', stream: false });
  });

  it('generateText forwards model, maxTokens, temperature and systemPrompt', async () => {
    const { fetchImpl, calls } = fakeFetch({ response: 'x' });
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    await provider.generateText('hi', {
      model: 'llama3.1',
      maxTokens: 123,
      temperature: 0.2,
      systemPrompt: 'SYS',
    });
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body).toMatchObject({
      model: 'llama3.1',
      system: 'SYS',
      options: { temperature: 0.2, num_predict: 123 },
    });
  });

  it('generateText falls back to the default model when none is supplied', async () => {
    const { fetchImpl, calls } = fakeFetch({ response: 'x' });
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    await provider.generateText('hi');
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.model).toBe('llama3');
  });

  it('generateWithTools embeds the tool docs in the prompt and returns plain text when the model does not call a tool', async () => {
    const { fetchImpl, calls } = fakeFetch({ response: 'just an answer' });
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    const tools: Tool[] = [{ name: 'report', description: 'd', inputSchema: { type: 'object' } }];
    const result = await provider.generateWithTools('go', tools);

    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.prompt).toContain('go');
    expect(body.prompt).toContain('report');
    expect(result.text).toBe('just an answer');
    expect(result.toolCalls).toEqual([]);
  });

  it('generateWithTools parses a toolCalls JSON envelope from the response', async () => {
    const { fetchImpl } = fakeFetch({
      response: JSON.stringify({ toolCalls: [{ name: 'report', input: { a: 1 } }] }),
    });
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    const result = await provider.generateWithTools('go', [
      { name: 'report', description: 'd', inputSchema: { type: 'object' } },
    ]);
    expect(result.toolCalls).toEqual([{ name: 'report', input: { a: 1 } }]);
    expect(result.text).toBeUndefined();
  });

  it('throws a ProviderError when the response is not ok', async () => {
    const { fetchImpl } = fakeFetch({}, { ok: false, status: 500 });
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    await expect(provider.generateText('hi')).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'E_PROVIDER',
    });
  });

  it('wraps a fetch rejection in a ProviderError', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network down');
    };
    const provider = new OllamaProvider(
      { model: 'llama3', baseUrl: 'http://localhost:11434' },
      fetchImpl,
    );
    await expect(provider.generateText('hi')).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'E_PROVIDER',
    });
  });
});

describe('buildOllamaPrompt', () => {
  it('returns the prompt unchanged when there are no tools', () => {
    expect(buildOllamaPrompt('hi', [])).toBe('hi');
  });

  it('appends tool docs when tools are present', () => {
    const prompt = buildOllamaPrompt('hi', [
      { name: 'report', description: 'd', inputSchema: { type: 'object' } },
    ]);
    expect(prompt).toContain('hi');
    expect(prompt).toContain('report');
    expect(prompt).toContain('toolCalls');
  });
});

describe('parseOllamaToolCalls', () => {
  it('returns undefined for plain text', () => {
    expect(parseOllamaToolCalls('just an answer')).toBeUndefined();
  });

  it('returns undefined for JSON without a toolCalls array', () => {
    expect(parseOllamaToolCalls('{"foo":1}')).toBeUndefined();
  });

  it('parses a toolCalls envelope', () => {
    expect(parseOllamaToolCalls('{"toolCalls":[{"name":"report","input":{"a":1}}]}')).toEqual([
      { name: 'report', input: { a: 1 } },
    ]);
  });
});
