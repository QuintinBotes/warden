import { describe, it, expect } from 'vitest';
import { escapeMarkdownCell, escapeRegExp, stripTrailingSlashes, slugify } from './text-safety';

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

describe('escapeRegExp', () => {
  it('makes a literal test title match only itself when compiled as a pattern', () => {
    const name = 'checkout [beta] applies coupon (50% off)';
    expect(new RegExp(escapeRegExp(name)).test(name)).toBe(true);
    // The bracketed part is literal text, not a character class matching one of `b`,`e`,`t`,`a`.
    expect(new RegExp(escapeRegExp(name)).test('checkout b applies coupon (50% off)')).toBe(false);
  });

  it('turns a title that is not a valid regex into one that compiles', () => {
    expect(() => new RegExp('cart [a+ unclosed')).toThrow();
    expect(new RegExp(escapeRegExp('cart [a+ unclosed')).test('cart [a+ unclosed')).toBe(true);
  });

  it('keeps an alternation of escaped titles separable', () => {
    const re = new RegExp(['search: a|b matches', 'checkout'].map(escapeRegExp).join('|'));
    expect(re.test('search: a|b matches')).toBe(true);
    expect(re.test('checkout')).toBe(true);
    expect(re.test('b matches')).toBe(false);
  });
});

describe('escapeMarkdownCell', () => {
  it('escapes a backslash before the pipe it precedes, so the row survives', () => {
    // The order is the bug. Escaping pipes first turns `\|` into `\\|`: Markdown renders the
    // pair as one literal backslash and the pipe then ends the row. CodeQL flagged exactly this
    // (js/incomplete-sanitization) in packages/github-action/src/report.ts, where the pair had
    // been hand-rolled in the wrong order beside two already-correct copies.
    expect(escapeMarkdownCell('a\\|b')).toBe('a\\\\\\|b');
  });

  it('escapes a lone backslash, which a Windows path in an error message is made of', () => {
    expect(escapeMarkdownCell('C:\\Users\\run')).toBe('C:\\\\Users\\\\run');
  });

  it('escapes a lone pipe', () => {
    expect(escapeMarkdownCell('a|b')).toBe('a\\|b');
  });

  it('collapses newlines, because a bare one ends the row', () => {
    expect(escapeMarkdownCell('one\r\ntwo\nthree')).toBe('one two three');
  });
});
