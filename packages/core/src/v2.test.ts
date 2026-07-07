import { describe, it, expect } from 'vitest';
import { createProviderRegistry, LearningModuleSchema } from './v2';
import { defineConfig } from './config';
import { fakeProvider } from './testing/fakes';

describe('createProviderRegistry', () => {
  it('creates a registered provider and throws for an unregistered one', () => {
    const ai = defineConfig({}).ai;
    const reg = createProviderRegistry();
    reg.register('anthropic', () => fakeProvider());
    expect(reg.create({ ...ai, provider: 'anthropic' }).name).toBe('fake');
    expect(() => reg.create({ ...ai, provider: 'openai' })).toThrow();
  });
});

describe('LearningModuleSchema', () => {
  it('parses a learning module with a stable embed id', () => {
    const mod = LearningModuleSchema.parse({
      id: 'LM-001',
      title: 'How checkout works',
      sourceExecutionId: 'EX-1',
      flow: 'checkout',
      script: 'First, add an item to the cart…',
      chapters: [{ title: 'Add to cart', atMs: 0 }],
      videoPath: 'learning/checkout.mp4',
      transcriptPath: 'learning/checkout.vtt',
      embedId: 'embed-abc123',
    });
    expect(mod.embedId).toBe('embed-abc123');
    expect(mod.chapters[0]?.atMs).toBe(0);
  });
});

describe('V2 config (additive)', () => {
  it('defaults every V2 block, leaving V1 behavior intact', () => {
    const cfg = defineConfig({});
    expect(cfg.learningContent.enabled).toBe(false);
    expect(cfg.learningContent.format).toBe('both');
    expect(cfg.observability.enabled).toBe(false);
    expect(cfg.dashboard.port).toBe(3001);
    expect(cfg.integrations.provider).toBe('none');
    // V1 defaults unchanged
    expect(cfg.ai.provider).toBe('anthropic');
    expect(cfg.gates.blockOnPassRateBelowPercent).toBe(90);
  });
});
