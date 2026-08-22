import { ConfigError } from './errors';

/**
 * A read-only reader for `warden.config.{ts,mts,cts,js,mjs,cjs}`.
 *
 * The config file arrives with `git clone`. On CI that clone is the *pull request's* head — a
 * file written by whoever opened the PR — and the process reading it is `warden agent`, holding
 * `ANTHROPIC_API_KEY` in its environment. Handing that file to a transpiler (c12 → jiti) runs it:
 * a two-line `warden.config.ts` executes arbitrary code before any agent work begins. So the
 * default path never evaluates the file. It reads the exported literal as *data* and refuses
 * everything else.
 *
 * The grammar is deliberately smaller than JavaScript. It accepts what a configuration file
 * actually is — object and array literals, quoted strings, numbers, `true`/`false`/`null`/
 * `undefined`, comments, trailing commas — plus the two module shapes the docs teach:
 * `export default …` and `module.exports = …`, either of which may be wrapped in
 * `defineConfig(…)` (a pure validate-and-fill call whose result `loadConfig` recomputes anyway,
 * so unwrapping it changes nothing). Leading `import` statements are skipped, since the only
 * binding a data config can legally use from one is `defineConfig`.
 *
 * Anything with a runtime effect — a call, a bare identifier, a template substitution, a spread,
 * a computed key — is a `ConfigError` naming the line. A refusal, never a silent partial read:
 * a config half-understood is a config that gates the wrong thing.
 */

interface Cursor {
  readonly src: string;
  readonly file: string;
  i: number;
}

/** How to get out of a refusal, appended to every parse error so the message is actionable. */
const REMEDY =
  'Warden reads its config as data and never executes it. Write the config as a plain object ' +
  'literal (or as warden.config.json), or set WARDEN_TRUST_CONFIG=1 to evaluate the file as ' +
  'code — only ever on a checkout you trust, never on a pull request from a fork.';

function fail(c: Cursor, at: number, message: string): never {
  const before = c.src.slice(0, at);
  const line = before.split('\n').length;
  const column = at - before.lastIndexOf('\n');
  throw new ConfigError(`${c.file}:${line}:${column} — ${message}. ${REMEDY}`);
}

/** Whitespace and both comment forms. Never entered from inside a string literal. */
function skipTrivia(c: Cursor): void {
  for (;;) {
    const ch = c.src[c.i];
    if (ch === undefined) return;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      c.i++;
      continue;
    }
    if (ch === '\uFEFF') {
      c.i++;
      continue;
    }
    if (ch === '/' && c.src[c.i + 1] === '/') {
      const nl = c.src.indexOf('\n', c.i);
      c.i = nl === -1 ? c.src.length : nl + 1;
      continue;
    }
    if (ch === '/' && c.src[c.i + 1] === '*') {
      const end = c.src.indexOf('*/', c.i + 2);
      if (end === -1) fail(c, c.i, 'unterminated block comment');
      c.i = end + 2;
      continue;
    }
    return;
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Reads an identifier at the cursor, or `undefined` if one does not start here. */
function readIdentifier(c: Cursor): string | undefined {
  const start = c.i;
  if (!IDENT_START.test(c.src[c.i] ?? '')) return undefined;
  c.i++;
  while (IDENT_PART.test(c.src[c.i] ?? '')) c.i++;
  return c.src.slice(start, c.i);
}

/** True when the identifier `word` begins at `c.i` and is not a prefix of a longer one. */
function peekWord(c: Cursor, word: string): boolean {
  if (!c.src.startsWith(word, c.i)) return false;
  return !IDENT_PART.test(c.src[c.i + word.length] ?? '');
}

const SINGLE_CHAR_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

/**
 * A quoted string. Backticks are accepted only without `${…}`: a substitution is an expression,
 * and an expression is the thing this parser exists to refuse.
 */
function parseString(c: Cursor): string {
  const quote = c.src[c.i];
  const opened = c.i;
  c.i++;
  let out = '';
  for (;;) {
    const ch = c.src[c.i];
    if (ch === undefined) fail(c, opened, 'unterminated string');
    if (ch === quote) {
      c.i++;
      return out;
    }
    if (ch === '\n' && quote !== '`') fail(c, c.i, 'unterminated string');
    if (quote === '`' && ch === '$' && c.src[c.i + 1] === '{') {
      fail(c, c.i, 'a template substitution is code, not data');
    }
    if (ch !== '\\') {
      out += ch;
      c.i++;
      continue;
    }
    const esc = c.src[c.i + 1];
    if (esc === undefined) fail(c, c.i, 'unterminated escape');
    c.i += 2;
    if (esc === 'u') {
      if (c.src[c.i] === '{') {
        const end = c.src.indexOf('}', c.i);
        if (end === -1) fail(c, c.i, 'unterminated unicode escape');
        out += String.fromCodePoint(Number.parseInt(c.src.slice(c.i + 1, end), 16));
        c.i = end + 1;
      } else {
        out += String.fromCharCode(Number.parseInt(c.src.slice(c.i, c.i + 4), 16));
        c.i += 4;
      }
      continue;
    }
    if (esc === 'x') {
      out += String.fromCharCode(Number.parseInt(c.src.slice(c.i, c.i + 2), 16));
      c.i += 2;
      continue;
    }
    if (esc === '\n') continue; // line continuation
    out += SINGLE_CHAR_ESCAPES[esc] ?? esc;
  }
}

// Decimal, hex, binary and octal literals, with an optional sign and exponent. `_` separators are
// allowed because TypeScript config files are hand-edited and `1_000` is a legal number there.
const NUMBER =
  /^[+-]?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)/;

function parseNumber(c: Cursor): number {
  const m = NUMBER.exec(c.src.slice(c.i));
  if (!m) fail(c, c.i, 'not a number');
  const text = m[0].replace(/_/g, '');
  const value = Number(text);
  if (Number.isNaN(value)) fail(c, c.i, `${m[0]} is not a number`);
  c.i += m[0].length;
  return value;
}

/**
 * Consumes a trailing `as const` / `satisfies SomeType`. Both are erased at compile time, so a
 * config carrying one is still data — but only the two forms below are recognised, so a cast
 * that hides a call (`x as unknown as (() => void)()`) is still a refusal.
 */
function skipTypeSuffix(c: Cursor): void {
  for (;;) {
    const save = c.i;
    skipTrivia(c);
    if (!peekWord(c, 'as') && !peekWord(c, 'satisfies')) {
      c.i = save;
      return;
    }
    readIdentifier(c);
    skipTrivia(c);
    if (readIdentifier(c) === undefined) fail(c, c.i, 'expected a type name');
    // A dotted type name (`Warden.ConfigInput`) and an array suffix are still type-only.
    for (;;) {
      const mark = c.i;
      skipTrivia(c);
      if (c.src[c.i] === '.' && IDENT_START.test(c.src[c.i + 1] ?? '')) {
        c.i++;
        readIdentifier(c);
        continue;
      }
      if (c.src[c.i] === '[' && c.src[c.i + 1] === ']') {
        c.i += 2;
        continue;
      }
      c.i = mark;
      break;
    }
  }
}

function parseObject(c: Cursor): Record<string, unknown> {
  const opened = c.i;
  c.i++; // '{'
  const out: Record<string, unknown> = {};
  for (;;) {
    skipTrivia(c);
    const ch = c.src[c.i];
    if (ch === undefined) fail(c, opened, 'unterminated object literal');
    if (ch === '}') {
      c.i++;
      return out;
    }
    if (c.src.startsWith('...', c.i)) fail(c, c.i, 'a spread copies a value at runtime');
    if (ch === '[') fail(c, c.i, 'a computed key is an expression');

    const keyAt = c.i;
    let key: string;
    if (ch === '"' || ch === "'" || ch === '`') key = parseString(c);
    else if (/[0-9]/.test(ch)) key = String(parseNumber(c));
    else {
      const ident = readIdentifier(c);
      if (ident === undefined)
        fail(c, c.i, `unexpected ${JSON.stringify(ch)} where a key was expected`);
      key = ident;
    }
    // `__proto__` as a data key would mutate the prototype of the object being built.
    if (key === '__proto__') fail(c, keyAt, '__proto__ is not a configuration key');

    skipTrivia(c);
    if (c.src[c.i] !== ':') {
      fail(c, c.i, `expected ':' after "${key}" (shorthand and methods are code, not data)`);
    }
    c.i++;
    out[key] = parseValue(c);

    skipTrivia(c);
    if (c.src[c.i] === ',') {
      c.i++;
      continue;
    }
    if (c.src[c.i] === '}') {
      c.i++;
      return out;
    }
    fail(c, c.i, "expected ',' or '}'");
  }
}

function parseArray(c: Cursor): unknown[] {
  const opened = c.i;
  c.i++; // '['
  const out: unknown[] = [];
  for (;;) {
    skipTrivia(c);
    const ch = c.src[c.i];
    if (ch === undefined) fail(c, opened, 'unterminated array literal');
    if (ch === ']') {
      c.i++;
      return out;
    }
    if (c.src.startsWith('...', c.i)) fail(c, c.i, 'a spread copies a value at runtime');
    out.push(parseValue(c));
    skipTrivia(c);
    if (c.src[c.i] === ',') {
      c.i++;
      continue;
    }
    if (c.src[c.i] === ']') {
      c.i++;
      return out;
    }
    fail(c, c.i, "expected ',' or ']'");
  }
}

function parseValue(c: Cursor): unknown {
  skipTrivia(c);
  const ch = c.src[c.i];
  if (ch === undefined) fail(c, c.i, 'expected a value');
  let value: unknown;
  if (ch === '{') value = parseObject(c);
  else if (ch === '[') value = parseArray(c);
  else if (ch === '"' || ch === "'" || ch === '`') value = parseString(c);
  else if (
    /[0-9]/.test(ch) ||
    ((ch === '-' || ch === '+' || ch === '.') && /[0-9.]/.test(c.src[c.i + 1] ?? ''))
  ) {
    value = parseNumber(c);
  } else {
    const at = c.i;
    const ident = readIdentifier(c);
    if (ident === 'true') value = true;
    else if (ident === 'false') value = false;
    else if (ident === 'null') value = null;
    else if (ident === 'undefined') value = undefined;
    else if (ident === 'defineConfig') {
      skipTrivia(c);
      if (c.src[c.i] !== '(')
        fail(c, at, 'defineConfig must be called with a single object literal');
      c.i++;
      value = parseValue(c);
      skipTrivia(c);
      if (c.src[c.i] === ',') {
        c.i++;
        skipTrivia(c);
      }
      if (c.src[c.i] !== ')') fail(c, c.i, "expected ')' after defineConfig(…)");
      c.i++;
    } else if (ident === undefined) {
      fail(c, at, `unexpected ${JSON.stringify(ch)} where a value was expected`);
    } else {
      fail(c, at, `"${ident}" is evaluated at runtime; only literal data is read here`);
    }
  }
  skipTypeSuffix(c);
  return value;
}

/** Skips an `import …` statement, including the multi-line brace form. */
function skipImport(c: Cursor): void {
  readIdentifier(c); // 'import'
  let braces = 0;
  let sawSpecifier = false;
  for (;;) {
    skipTrivia(c);
    const ch = c.src[c.i];
    if (ch === undefined) return;
    if (ch === '"' || ch === "'" || ch === '`') {
      parseString(c);
      sawSpecifier = true;
      continue;
    }
    if (ch === '{') {
      braces++;
      c.i++;
      continue;
    }
    if (ch === '}') {
      braces--;
      c.i++;
      continue;
    }
    if (ch === ';' && braces === 0) {
      c.i++;
      return;
    }
    if (ch === '(') fail(c, c.i, 'a dynamic import runs code');
    // `import x from 'y'` with no semicolon ends at the newline after the module specifier.
    if (sawSpecifier && braces === 0) return;
    c.i++;
  }
}

/**
 * Reads `source` as a Warden config module and returns the exported data, or throws
 * `ConfigError` describing the first construct that is not data. Nothing in `source` is executed.
 */
export function parseConfigModule(source: string, file: string): unknown {
  const c: Cursor = { src: source, file, i: 0 };
  if (c.src.startsWith('#!')) {
    const nl = c.src.indexOf('\n');
    c.i = nl === -1 ? c.src.length : nl + 1;
  }
  for (;;) {
    skipTrivia(c);
    if (c.i >= c.src.length) {
      throw new ConfigError(
        `${file} has no default export. A Warden config exports its settings as ` +
          `\`export default { … }\`. ${REMEDY}`,
      );
    }
    if (peekWord(c, 'import')) {
      skipImport(c);
      continue;
    }
    if (peekWord(c, 'export')) {
      const at = c.i;
      readIdentifier(c);
      skipTrivia(c);
      if (!peekWord(c, 'default')) {
        fail(c, at, 'only `export default` is read from a config file');
      }
      readIdentifier(c);
      const value = parseValue(c);
      skipTrivia(c);
      if (c.src[c.i] === ';') c.i++;
      skipTrivia(c);
      if (c.i < c.src.length) fail(c, c.i, 'nothing may follow the default export');
      return value;
    }
    if (c.src.startsWith('module.exports', c.i)) {
      c.i += 'module.exports'.length;
      skipTrivia(c);
      if (c.src[c.i] !== '=') fail(c, c.i, "expected '=' after module.exports");
      c.i++;
      const value = parseValue(c);
      skipTrivia(c);
      if (c.src[c.i] === ';') c.i++;
      skipTrivia(c);
      if (c.i < c.src.length) fail(c, c.i, 'nothing may follow module.exports');
      return value;
    }
    fail(c, c.i, 'a config file may only contain imports and its default export');
  }
}
