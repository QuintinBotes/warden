import { describe, it, expect } from 'vitest';
import type { Tool } from '@warden/core';
import { AnthropicProvider, mapToAnthropicTool, type AnthropicLike } from './anthropic-provider';

function fakeClient(response: unknown) {
  const calls: Record<string, unknown>[] = [];
  const client: AnthropicLike = {
    messages: {
      async create(args) {
        calls.push(args);
        return response;
      },
    },
  };
  return { client, calls };
}

describe('AnthropicProvider', () => {
  it('exposes name "anthropic"', () => {
    const { client } = fakeClient({ content: [] });
    const provider = new AnthropicProvider(client, { model: 'claude-sonnet-5' });
    expect(provider.name).toBe('anthropic');
  });

  it('generateText concatenates text blocks from the response', async () => {
    const { client } = fakeClient({
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ],
    });
    const provider = new AnthropicProvider(client, { model: 'claude-sonnet-5' });
    expect(await provider.generateText('hi')).toBe('Hello world');
  });

  it('generateText forwards model, maxTokens, temperature, systemPrompt and the prompt', async () => {
    const { client, calls } = fakeClient({ content: [{ type: 'text', text: 'x' }] });
    const provider = new AnthropicProvider(client, { model: 'claude-sonnet-5' });
    await provider.generateText('hi', {
      model: 'claude-opus-4-5',
      maxTokens: 123,
      temperature: 0.2,
      systemPrompt: 'SYS',
    });
    expect(calls[0]).toMatchObject({
      model: 'claude-opus-4-5',
      max_tokens: 123,
      temperature: 0.2,
      system: 'SYS',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('generateText falls back to the default model when none is supplied', async () => {
    const { client, calls } = fakeClient({ content: [{ type: 'text', text: 'x' }] });
    const provider = new AnthropicProvider(client, { model: 'claude-sonnet-5' });
    await provider.generateText('hi');
    expect(calls[0]!.model).toBe('claude-sonnet-5');
  });

  it('generateWithTools maps Tool[] to the anthropic tool format and parses tool_use blocks', async () => {
    const { client, calls } = fakeClient({
      content: [
        { type: 'text', text: 'thinking' },
        { type: 'tool_use', name: 'report', input: { a: 1 } },
      ],
    });
    const provider = new AnthropicProvider(client, { model: 'm' });
    const tools: Tool[] = [{ name: 'report', description: 'd', inputSchema: { type: 'object' } }];
    const result = await provider.generateWithTools('go', tools);

    expect(calls[0]!.tools).toEqual([
      { name: 'report', description: 'd', input_schema: { type: 'object' } },
    ]);
    expect(result.text).toBe('thinking');
    expect(result.toolCalls).toEqual([{ name: 'report', input: { a: 1 } }]);
    expect(result.raw).toBeDefined();
  });

  it('generateWithTools returns undefined text when there are no text blocks', async () => {
    const { client } = fakeClient({
      content: [{ type: 'tool_use', name: 'report', input: {} }],
    });
    const provider = new AnthropicProvider(client, { model: 'm' });
    const result = await provider.generateWithTools('go', []);
    expect(result.text).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
  });

  it('wraps a client failure in a ProviderError', async () => {
    const client: AnthropicLike = {
      messages: {
        async create() {
          throw new Error('boom');
        },
      },
    };
    const provider = new AnthropicProvider(client, { model: 'm' });
    await expect(provider.generateText('hi')).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'E_PROVIDER',
    });
  });
});

describe('mapToAnthropicTool', () => {
  it('renames inputSchema to input_schema', () => {
    expect(
      mapToAnthropicTool({ name: 'n', description: 'd', inputSchema: { type: 'object' } }),
    ).toEqual({ name: 'n', description: 'd', input_schema: { type: 'object' } });
  });
});
