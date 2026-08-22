import { describe, it, expect } from 'vitest';
import { parseConfigModule } from './config-source';
import { ConfigError } from './errors';

const parse = (src: string) => parseConfigModule(src, 'warden.config.ts');

describe('parseConfigModule reads what a config file legitimately is', () => {
  it('reads the scaffolded shape: comments, nested objects, arrays, trailing commas', () => {
    expect(
      parse(`/**
 * Warden configuration.
 * @type {import('@warden/core').WardenConfigInput}
 */
export default {
  ai: { provider: 'anthropic', model: 'claude-sonnet-5' }, // inline comment
  scope: {
    highRiskPatterns: ['auth', 'payment'],
    sharedPaths: ['lib/', 'shared/'],
  },
  gates: { blockOnCritical: true, blockOnPassRateBelowPercent: 90 },
};
`),
    ).toEqual({
      ai: { provider: 'anthropic', model: 'claude-sonnet-5' },
      scope: { highRiskPatterns: ['auth', 'payment'], sharedPaths: ['lib/', 'shared/'] },
      gates: { blockOnCritical: true, blockOnPassRateBelowPercent: 90 },
    });
  });

  it('unwraps defineConfig() and skips the import that provided it', () => {
    expect(
      parse(
        `import { defineConfig } from '@warden/core';\nexport default defineConfig({ a: 1 });\n`,
      ),
    ).toEqual({ a: 1 });
  });

  it('skips a multi-line import and one without a semicolon', () => {
    expect(
      parse(
        `import {\n  defineConfig,\n} from '@warden/core'\nimport 'node:process';\nexport default { a: 1 };\n`,
      ),
    ).toEqual({ a: 1 });
  });

  it('reads module.exports, quoted keys, negatives, floats and escapes', () => {
    expect(
      parse(
        `module.exports = { "a-b": -1.5, c: 1e3, d: "line\\nbreak", e: null, f: [true, false] };`,
      ),
    ).toEqual({ 'a-b': -1.5, c: 1000, d: 'line\nbreak', e: null, f: [true, false] });
  });

  it('accepts the type-only suffixes TypeScript users write', () => {
    expect(parse(`export default { a: 1 } satisfies Foo.Bar;`)).toEqual({ a: 1 });
    expect(parse(`export default { a: ['x'] as const };`)).toEqual({ a: ['x'] });
  });

  it('reads a backtick string that has no substitution in it', () => {
    expect(parse('export default { a: `plain` };')).toEqual({ a: 'plain' });
  });
});

describe('parseConfigModule refuses anything that would run', () => {
  const refuses = (src: string, match: RegExp) => {
    expect(() => parse(src)).toThrow(ConfigError);
    expect(() => parse(src)).toThrow(match);
  };

  it('refuses a top-level statement with an effect', () => {
    refuses(
      `import { writeFileSync } from 'node:fs';\nwriteFileSync('/tmp/x', 'pwned');\nexport default {};\n`,
      /only contain imports and its default export/,
    );
  });

  it('refuses a call in a value position', () => {
    refuses(`export default { a: process.env.SECRET };`, /"process" is evaluated at runtime/);
    refuses(`export default { a: require('node:fs') };`, /"require" is evaluated at runtime/);
    refuses(`export default { a: (() => 1)() };`, /where a value was expected/);
  });

  it('refuses a template substitution', () => {
    refuses('export default { a: `${process.env.HOME}` };', /template substitution is code/);
  });

  it('refuses a spread, a computed key and a shorthand', () => {
    refuses(`export default { ...base, a: 1 };`, /spread copies a value at runtime/);
    refuses(`export default { [key]: 1 };`, /computed key is an expression/);
    refuses(`export default { a };`, /shorthand and methods are code/);
  });

  it('refuses __proto__ as a key rather than mutating a prototype', () => {
    refuses(`export default { __proto__: { polluted: 1 } };`, /not a configuration key/);
  });

  it('refuses a dynamic import', () => {
    refuses(`import('node:fs');\nexport default {};`, /dynamic import runs code/);
  });

  it('refuses trailing statements after the default export', () => {
    refuses(`export default {};\nwriteFileSync('/tmp/x', 'y');`, /nothing may follow/);
  });

  it('names the line and says how to fix it', () => {
    expect(() => parse(`export default {\n  a: 1,\n  b: boom(),\n};`)).toThrow(
      /warden\.config\.ts:3:6 .*WARDEN_TRUST_CONFIG=1/s,
    );
  });

  it('refuses a file with no default export instead of silently using defaults', () => {
    expect(() => parse(`const a = 1;\n`)).toThrow(ConfigError);
    expect(() => parse(`// nothing here\n`)).toThrow(/no default export/);
  });
});
