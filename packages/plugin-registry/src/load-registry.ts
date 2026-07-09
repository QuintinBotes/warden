import type { FileAccess, PluginManifest, PluginRegistrySource } from '@warden/core';
import { parseManifest } from './manifest.js';
import { createRegistry, type Registry } from './registry.js';

const MANIFEST_SUFFIX = '.manifest.json';

/**
 * Discover and validate {@link PluginManifest}s from a list of {@link PluginRegistrySource}s,
 * using the injected {@link FileAccess} for all I/O.
 *
 * - `dir` sources read every `*.manifest.json` file in the directory.
 * - `index` sources read a single JSON file containing an array of manifests.
 *
 * Invalid or malformed manifests (and missing files) are skipped rather than throwing, so one bad
 * plugin never breaks the whole load. Manifests are deduped by name across the union of sources,
 * with later sources winning over earlier ones.
 */
export async function loadRegistry(
  sources: PluginRegistrySource[],
  fileAccess: FileAccess,
): Promise<Registry> {
  const collected: PluginManifest[] = [];
  for (const source of sources) {
    if (source.kind === 'dir') {
      collected.push(...(await loadDir(source.location, fileAccess)));
    } else {
      collected.push(...(await loadIndex(source.location, fileAccess)));
    }
  }

  // Dedupe by name; later entries (later sources) overwrite earlier ones.
  const byName = new Map<string, PluginManifest>();
  for (const manifest of collected) {
    byName.set(manifest.name, manifest);
  }
  return createRegistry([...byName.values()]);
}

async function loadDir(dir: string, fileAccess: FileAccess): Promise<PluginManifest[]> {
  const paths = await fileAccess.listFiles(dir);
  const manifests: PluginManifest[] = [];
  for (const path of paths) {
    if (!path.endsWith(MANIFEST_SUFFIX)) continue;
    const raw = await fileAccess.readFile(path);
    if (raw === null) continue;
    const manifest = tryParseManifest(raw);
    if (manifest !== null) manifests.push(manifest);
  }
  return manifests;
}

async function loadIndex(location: string, fileAccess: FileAccess): Promise<PluginManifest[]> {
  const raw = await fileAccess.readFile(location);
  if (raw === null) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const manifests: PluginManifest[] = [];
  for (const entry of value) {
    const manifest = tryParseManifest(JSON.stringify(entry));
    if (manifest !== null) manifests.push(manifest);
  }
  return manifests;
}

function tryParseManifest(raw: string): PluginManifest | null {
  try {
    return parseManifest(raw);
  } catch {
    return null;
  }
}
