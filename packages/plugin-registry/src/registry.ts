import type { PluginManifest, PluginSearchQuery } from '@warden/core';

/** An in-memory, queryable set of {@link PluginManifest}s. */
export interface Registry {
  /** Every manifest in the registry (a defensive copy). */
  list(): PluginManifest[];
  /** The manifest with the given name, or `null` when none matches. */
  get(name: string): PluginManifest | null;
  /** Manifests matching every provided field of the query (see {@link PluginSearchQuery}). */
  search(query: PluginSearchQuery): PluginManifest[];
}

/**
 * Build a {@link Registry} over the given manifests.
 *
 * `search` ANDs the provided fields: `text` is a case-insensitive substring matched over the
 * name, description, and tags; `capability` must appear exactly in `capabilities`; `tag` must
 * appear exactly in `tags`. Omitted fields match anything.
 */
export function createRegistry(manifests: PluginManifest[]): Registry {
  const items: PluginManifest[] = [...manifests];
  return {
    list(): PluginManifest[] {
      return [...items];
    },
    get(name: string): PluginManifest | null {
      return items.find((manifest) => manifest.name === name) ?? null;
    },
    search(query: PluginSearchQuery): PluginManifest[] {
      return items.filter((manifest) => matchesQuery(manifest, query));
    },
  };
}

function matchesQuery(manifest: PluginManifest, query: PluginSearchQuery): boolean {
  if (query.text !== undefined) {
    const needle = query.text.toLowerCase();
    const haystack = [manifest.name, manifest.description, ...manifest.tags]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (query.capability !== undefined && !manifest.capabilities.includes(query.capability)) {
    return false;
  }
  if (query.tag !== undefined && !manifest.tags.includes(query.tag)) {
    return false;
  }
  return true;
}
