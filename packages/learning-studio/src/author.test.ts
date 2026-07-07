import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureExecution, fakeProvider } from '@warden/core/testing';
import { AUTHOR_LEARNING_MODULE_TOOL, AuthoredContentSchema, authorContent } from './author';

const cfg = defineConfig({ learningContent: { enabled: true } });
const execution = fixtureExecution();

describe('AUTHOR_LEARNING_MODULE_TOOL', () => {
  it('describes a tool the provider can call to author a module', () => {
    expect(AUTHOR_LEARNING_MODULE_TOOL.name).toBe('author_learning_module');
    expect(typeof AUTHOR_LEARNING_MODULE_TOOL.description).toBe('string');
    expect(AUTHOR_LEARNING_MODULE_TOOL.inputSchema).toMatchObject({ type: 'object' });
  });
});

describe('AuthoredContentSchema', () => {
  it('requires a script and allows optional title/chapters/article', () => {
    const parsed = AuthoredContentSchema.parse({ script: 'hello' });
    expect(parsed.script).toBe('hello');
    expect(AuthoredContentSchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('authorContent', () => {
  it('parses the structured tool call from the provider', async () => {
    const provider = fakeProvider({
      toolCalls: [
        {
          name: 'author_learning_module',
          input: {
            title: 'Checkout, explained',
            script: 'Open the cart, then pay.',
            chapters: [{ title: 'Open cart', atMs: 0 }],
            article: '# Checkout',
          },
        },
      ],
    });
    const authored = await authorContent(provider, { flow: 'TC-1', execution }, cfg);
    expect(authored.title).toBe('Checkout, explained');
    expect(authored.script).toBe('Open the cart, then pay.');
    expect(authored.chapters).toEqual([{ title: 'Open cart', atMs: 0 }]);
    expect(authored.article).toBe('# Checkout');
    // The provider was actually consulted (hermetic fake).
    expect(provider.calls.some((c) => c.method === 'generateWithTools')).toBe(true);
  });

  it('falls back to the raw text answer when no tool call is returned', async () => {
    const provider = fakeProvider({ text: 'A plain narration.' });
    const authored = await authorContent(provider, { flow: 'TC-1', execution }, cfg);
    expect(authored.script).toBe('A plain narration.');
  });

  it('throws ProviderError when the provider yields nothing usable', async () => {
    const provider = fakeProvider({ text: '' });
    await expect(authorContent(provider, { flow: 'TC-1', execution }, cfg)).rejects.toMatchObject({
      code: 'E_PROVIDER',
    });
  });
});
