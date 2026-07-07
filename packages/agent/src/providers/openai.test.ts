import { describe, it, expect } from 'vitest';
import type { Tool } from '@warden/core';
import { OpenAIProvider, mapToOpenAITool, type OpenAILike } from './openai';

function fakeClient(response: unknown) {
  const calls: Record<string, unknown>[] = [];
  const client: OpenAILike = {
    chat: {
      completions: {
        async create(args) {
          calls.push(args);
          return response;
        },
      },
    },
  };
  return { client, calls };
}

describe('OpenAIProvider', () => {
  it('exposes name "openai"', () => {
    const { client } = fakeClient({ choices: [] });
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    expect(provider.name).toBe('openai');
  });

  it('generateText returns the message content', async () => {
    const { client } = fakeClient({ choices: [{ message: { content: 'hello there' } }] });
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    expect(await provider.generateText('hi')).toBe('hello there');
  });

  it('generateText forwards model, maxTokens, temperature, systemPrompt and the prompt', async () => {
    const { client, calls } = fakeClient({ choices: [{ message: { content: 'x' } }] });
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    await provider.generateText('hi', {
      model: 'gpt-4o-mini',
      maxTokens: 123,
      temperature: 0.2,
      systemPrompt: 'SYS',
    });
    expect(calls[0]).toMatchObject({
      model: 'gpt-4o-mini',
      max_tokens: 123,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hi' },
      ],
    });
  });

  it('generateText falls back to the default model when none is supplied', async () => {
    const { client, calls } = fakeClient({ choices: [{ message: { content: 'x' } }] });
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    await provider.generateText('hi');
    expect(calls[0]!.model).toBe('gpt-4o');
  });

  it('generateWithTools maps Tool[] to the OpenAI function-tool format and parses tool_calls', async () => {
    const { client, calls } = fakeClient({
      choices: [
        {
          message: {
            content: 'thinking',
            tool_calls: [{ function: { name: 'report', arguments: '{"a":1}' } }],
          },
        },
      ],
    });
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    const tools: Tool[] = [{ name: 'report', description: 'd', inputSchema: { type: 'object' } }];
    const result = await provider.generateWithTools('go', tools);

    expect(calls[0]!.tools).toEqual([
      {
        type: 'function',
        function: { name: 'report', description: 'd', parameters: { type: 'object' } },
      },
    ]);
    expect(result.text).toBe('thinking');
    expect(result.toolCalls).toEqual([{ name: 'report', input: { a: 1 } }]);
    expect(result.raw).toBeDefined();
  });

  it('generateWithTools returns undefined text when content is empty', async () => {
    const { client } = fakeClient({
      choices: [
        {
          message: { content: '', tool_calls: [{ function: { name: 'report', arguments: '{}' } }] },
        },
      ],
    });
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    const result = await provider.generateWithTools('go', []);
    expect(result.text).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
  });

  it('generateWithTools falls back to raw string input when arguments are not valid JSON', async () => {
    const { client } = fakeClient({
      choices: [
        { message: { tool_calls: [{ function: { name: 'report', arguments: 'not-json' } }] } },
      ],
    });
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    const result = await provider.generateWithTools('go', []);
    expect(result.toolCalls).toEqual([{ name: 'report', input: 'not-json' }]);
  });

  it('wraps a client failure in a ProviderError', async () => {
    const client: OpenAILike = {
      chat: {
        completions: {
          async create() {
            throw new Error('boom');
          },
        },
      },
    };
    const provider = new OpenAIProvider(client, { model: 'gpt-4o' });
    await expect(provider.generateText('hi')).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'E_PROVIDER',
    });
  });
});

describe('mapToOpenAITool', () => {
  it('wraps the tool in the function-tool wire format', () => {
    expect(
      mapToOpenAITool({ name: 'n', description: 'd', inputSchema: { type: 'object' } }),
    ).toEqual({
      type: 'function',
      function: { name: 'n', description: 'd', parameters: { type: 'object' } },
    });
  });
});
