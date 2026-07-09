import { describe, expect, it } from 'vitest';
import type { FileAccess, PluginRegistrySource } from '@warden/core';
import { loadRegistry } from './load-registry.js';

/** In-memory {@link FileAccess}: `listFiles(dir)` returns every full path under `dir`. */
function memFileAccess(tree: Record<string, string>): FileAccess {
  const paths = Object.keys(tree);
  return {
    async listFiles(dir: string): Promise<string[]> {
      const prefix = dir === '' ? '' : dir.endsWith('/') ? dir : `${dir}/`;
      return paths.filter((p) => prefix === '' || p.startsWith(prefix)).sort();
    },
    async readFile(path: string): Promise<string | null> {
      return Object.prototype.hasOwnProperty.call(tree, path) ? tree[path]! : null;
    },
  };
}

function manifestJson(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name, version: '1.0.0', entry: './p.js', ...extra });
}

const names = (list: { name: string }[]): string[] => list.map((m) => m.name).sort();

describe('loadRegistry', () => {
  it('reads *.manifest.json from a dir source, skipping invalid and non-manifest files', async () => {
    const fa = memFileAccess({
      'plugins/a.manifest.json': manifestJson('@acme/a', { tags: ['x'] }),
      'plugins/b.manifest.json': manifestJson('@acme/b'),
      'plugins/broken.manifest.json': '{ not json',
      'plugins/invalid.manifest.json': JSON.stringify({ version: '1' }),
      'plugins/readme.txt': 'ignore me',
      'plugins/notes.json': manifestJson('@acme/ignored-not-a-manifest'),
    });
    const registry = await loadRegistry([{ kind: 'dir', location: 'plugins' }], fa);
    expect(names(registry.list())).toEqual(['@acme/a', '@acme/b']);
  });

  it('reads a JSON array of manifests from an index source, skipping invalid entries', async () => {
    const fa = memFileAccess({
      'index.json': JSON.stringify([
        { name: '@acme/c', version: '1', entry: './c.js' },
        { version: '1', entry: './bad.js' },
        { name: '@acme/d', version: '1', entry: './d.js' },
      ]),
    });
    const registry = await loadRegistry([{ kind: 'index', location: 'index.json' }], fa);
    expect(names(registry.list())).toEqual(['@acme/c', '@acme/d']);
  });

  it('dedupes by name across sources, with the later source winning', async () => {
    const fa = memFileAccess({
      'plugins/dup.manifest.json': manifestJson('@acme/dup', {
        version: '1.0.0',
        tags: ['old'],
      }),
      'index.json': JSON.stringify([
        { name: '@acme/dup', version: '2.0.0', entry: './p.js', tags: ['new'] },
      ]),
    });
    const sources: PluginRegistrySource[] = [
      { kind: 'dir', location: 'plugins' },
      { kind: 'index', location: 'index.json' },
    ];
    const registry = await loadRegistry(sources, fa);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('@acme/dup')?.version).toBe('2.0.0');
    expect(registry.get('@acme/dup')?.tags).toEqual(['new']);
  });

  it('never throws when a source file is missing or a dir is empty', async () => {
    const registry = await loadRegistry(
      [
        { kind: 'index', location: 'missing.json' },
        { kind: 'dir', location: 'empty' },
      ],
      memFileAccess({}),
    );
    expect(registry.list()).toEqual([]);
  });

  it('skips an index file whose top-level JSON is not an array', async () => {
    const fa = memFileAccess({ 'index.json': JSON.stringify({ name: 'not-an-array' }) });
    const registry = await loadRegistry([{ kind: 'index', location: 'index.json' }], fa);
    expect(registry.list()).toEqual([]);
  });

  it('skips an index file with malformed JSON', async () => {
    const fa = memFileAccess({ 'index.json': '{ not json' });
    const registry = await loadRegistry([{ kind: 'index', location: 'index.json' }], fa);
    expect(registry.list()).toEqual([]);
  });
});
