import { describe, it, expect } from 'vitest';
import type { StrategyName } from '@warden/core';
import { createStrategy } from './create-strategy';
import { ExploratoryStrategy } from './exploratory-strategy';
import { GenerativeStrategy } from './generative-strategy';
import { HealerStrategy } from './healer-strategy';

describe('createStrategy', () => {
  it('creates the exploratory strategy', () => {
    const s = createStrategy('exploratory');
    expect(s).toBeInstanceOf(ExploratoryStrategy);
    expect(s.name).toBe('exploratory');
  });

  it('creates the generative strategy', () => {
    const s = createStrategy('generative');
    expect(s).toBeInstanceOf(GenerativeStrategy);
    expect(s.name).toBe('generative');
  });

  it('creates the healer strategy', () => {
    const s = createStrategy('healer');
    expect(s).toBeInstanceOf(HealerStrategy);
    expect(s.name).toBe('healer');
  });

  it('throws a ProviderError for an unknown strategy name', () => {
    expect(() => createStrategy('nope' as StrategyName)).toThrowError(/Unknown/);
  });
});
