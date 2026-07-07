import { describe, it, expect } from 'vitest';
import type { Tool } from '@warden/core';
import { GeminiProvider, mapToGeminiTools, type GeminiLike } from './gemini';

function fakeClient(response: unknown) {
  const calls: Record<string, unknown>[] = [];
  const client: GeminiLike = {
    async generateContent(args) {
      calls.push(args);
      return response;
    },
  };
  return { client, calls };
}

describe('GeminiProvider', () => {
  it('exposes name "gemini"', () => {
    const { client } = fakeClient({ candidates: [] });
    const provider = new GeminiProvider(client, { model: 'gemini-2.5-pro' });
    expect(provider.name).toBe('gemini');
  });

  it('generateText concatenates text parts from the response', async () => {
    const { client } = fakeClient({
      candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'world' }] } }],
    });
    const provider = new GeminiProvider(client, { model: 'gemini-2.5-pro' });
    expect(await provider.generateText('hi')).toBe('Hello world');
  });

  it('generateText forwards model, maxTokens, temperature, systemPrompt and the prompt', async () => {
    const { client, calls } = fakeClient({ candidates: [{ content: { parts: [{ text: 'x' }] } }] });
    const provider = new GeminiProvider(client, { model: 'gemini-2.5-pro' });
    await provider.generateText('hi', {
      model: 'gemini-2.5-flash',
      maxTokens: 123,
      temperature: 0.2,
      systemPrompt: 'SYS',
    });
    expect(calls[0]).toMatchObject({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      systemInstruction: { parts: [{ text: 'SYS' }] },
      generationConfig: { maxOutputTokens: 123, temperature: 0.2 },
    });
  });

  it('generateText falls back to the default model when none is supplied', async () => {
    const { client, calls } = fakeClient({ candidates: [{ content: { parts: [{ text: 'x' }] } }] });
    const provider = new GeminiProvider(client, { model: 'gemini-2.5-pro' });
    await provider.generateText('hi');
    expect(calls[0]!.model).toBe('gemini-2.5-pro');
  });

  it('generateWithTools maps Tool[] to the Gemini functionDeclarations format and parses functionCall parts', async () => {
    const { client, calls } = fakeClient({
      candidates: [
        {
          content: {
            parts: [{ text: 'thinking' }, { functionCall: { name: 'report', args: { a: 1 } } }],
          },
        },
      ],
    });
    const provider = new GeminiProvider(client, { model: 'gemini-2.5-pro' });
    const tools: Tool[] = [{ name: 'report', description: 'd', inputSchema: { type: 'object' } }];
    const result = await provider.generateWithTools('go', tools);

    expect(calls[0]!.tools).toEqual([
      {
        functionDeclarations: [
          { name: 'report', description: 'd', parameters: { type: 'object' } },
        ],
      },
    ]);
    expect(result.text).toBe('thinking');
    expect(result.toolCalls).toEqual([{ name: 'report', input: { a: 1 } }]);
    expect(result.raw).toBeDefined();
  });

  it('generateWithTools returns undefined text when there are no text parts', async () => {
    const { client } = fakeClient({
      candidates: [{ content: { parts: [{ functionCall: { name: 'report', args: {} } }] } }],
    });
    const provider = new GeminiProvider(client, { model: 'gemini-2.5-pro' });
    const result = await provider.generateWithTools('go', []);
    expect(result.text).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
  });

  it('wraps a client failure in a ProviderError', async () => {
    const client: GeminiLike = {
      async generateContent() {
        throw new Error('boom');
      },
    };
    const provider = new GeminiProvider(client, { model: 'gemini-2.5-pro' });
    await expect(provider.generateText('hi')).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'E_PROVIDER',
    });
  });
});

describe('mapToGeminiTools', () => {
  it('groups tools under a single functionDeclarations entry', () => {
    expect(
      mapToGeminiTools([{ name: 'n', description: 'd', inputSchema: { type: 'object' } }]),
    ).toEqual([
      { functionDeclarations: [{ name: 'n', description: 'd', parameters: { type: 'object' } }] },
    ]);
  });
});
