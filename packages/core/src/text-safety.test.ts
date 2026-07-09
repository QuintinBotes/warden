import { describe, it, expect } from 'vitest';
import { stripTrailingSlashes, slugify } from './text-safety';

describe('stripTrailingSlashes', () => {
  it('matches the old /\\/+$/ replace on the cases that matter', () => {
    expect(stripTrailingSlashes('https://x.com/')).toBe('https://x.com');
    expect(stripTrailingSlashes('https://x.com///')).toBe('https://x.com');
    expect(stripTrailingSlashes('https://x.com')).toBe('https://x.com');
    expect(stripTrailingSlashes('')).toBe('');
    expect(stripTrailingSlashes('///')).toBe('');
    // interior slashes untouched
    expect(stripTrailingSlashes('a/b/c/')).toBe('a/b/c');
  });
});

describe('slugify', () => {
  it('matches the old slug regex behavior', () => {
    expect(slugify('apps/checkout')).toBe('apps-checkout');
    expect(slugify('Hello, World!!!')).toBe('Hello-World');
    expect(slugify('---leading and trailing---')).toBe('leading-and-trailing');
    expect(slugify('a__b--c')).toBe('a-b-c');
    expect(slugify('!!!')).toBe('');
    expect(slugify('Keep123Case')).toBe('Keep123Case');
  });
});
