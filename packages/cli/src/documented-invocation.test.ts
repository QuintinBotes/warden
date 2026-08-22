import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every command Warden's documentation asks a reader to copy has to resolve to Warden.
 *
 * `npx warden …` does not. The unscoped name `warden` on npm belongs to an unrelated
 * package published in 2014 that declares no `bin`, so npx downloads a stranger's tarball
 * and then fails with "could not determine executable to run". A doc that prints that
 * command is not merely stale: following it fetches and runs someone else's code.
 *
 * The guard reads fenced code blocks only — those are what a reader copies verbatim into a
 * shell or a workflow file. Prose is free to name `npx warden` in order to warn against it.
 */
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('could not locate the workspace root');
    dir = parent;
  }
  return dir;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo', '.next']);

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, out);
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Every line inside a ``` fence, with its 1-based line number. */
function fencedLines(markdown: string): { line: number; text: string }[] {
  const lines = markdown.split(/\r?\n/);
  const out: { line: number; text: string }[] = [];
  let inFence = false;
  lines.forEach((text, i) => {
    if (text.trimStart().startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (inFence) out.push({ line: i + 1, text });
  });
  return out;
}

/**
 * True when an npx call would resolve the *package* `warden` — the stranger's one.
 *
 * npx takes its package spec from `--package`/`-p` when given, and otherwise from the first
 * positional argument. `npx --package=@warden/cli -- warden run` therefore names Warden and
 * is fine; `npx warden run` and `npx -- warden run` do not.
 */
function resolvesTheUnscopedPackage(text: string): boolean {
  const call = /\bnpx\b(.*)$/.exec(text);
  if (!call) return false;
  const rest = call[1]!;
  if (/(?:--package[= ]|(?:^|\s)-p\s+)\S+/.test(rest)) return false;
  for (const token of rest.trim().split(/\s+/)) {
    if (token === '--' || token.startsWith('-')) continue;
    return token === 'warden' || token.startsWith('warden@');
  }
  return false;
}

describe('the commands the documentation tells a reader to run', () => {
  const root = repoRoot();
  const docs = markdownFiles(root);

  it('finds the documentation to check', () => {
    expect(docs.length).toBeGreaterThan(5);
  });

  it('never tell npx to resolve the unrelated public `warden` package', () => {
    const offenders: string[] = [];
    for (const file of docs) {
      for (const { line, text } of fencedLines(readFileSync(file, 'utf-8'))) {
        if (resolvesTheUnscopedPackage(text)) {
          offenders.push(`${path.relative(root, file)}:${line}: ${text.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `these documented commands install someone else's package:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('recognizes both spellings, so the guard cannot pass by accident', () => {
    expect(resolvesTheUnscopedPackage('npx warden init')).toBe(true);
    expect(resolvesTheUnscopedPackage('npx --yes warden@latest init')).toBe(true);
    expect(resolvesTheUnscopedPackage('npx -- warden init')).toBe(true);
    expect(resolvesTheUnscopedPackage('npx --yes --package=@warden/cli -- warden init')).toBe(
      false,
    );
    expect(resolvesTheUnscopedPackage('npx playwright install')).toBe(false);
    expect(resolvesTheUnscopedPackage('node packages/cli/dist/bin/warden.js init')).toBe(false);
  });
});
