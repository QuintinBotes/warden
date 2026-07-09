import { z } from 'zod';

/**
 * Plugin registry contracts. A manifest describes a `QAPlatformPlugin` so it can be discovered,
 * searched, and resolved without hard-coding it into a config. `@warden/plugin-registry` implements
 * the registry + loader. Opt-in; the OSS core still works with directly-constructed plugins.
 */

export const PluginManifestSchema = z.object({
  /** Unique plugin name, e.g. `@acme/warden-slack`. */
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
  /** Module specifier to import for the plugin factory (its default export or a named `plugin`). */
  entry: z.string().min(1),
  /** Hook names the plugin implements, e.g. `['onGateDecision', 'onBugFound']` — used for search. */
  capabilities: z.array(z.string()).default([]),
  /** Free-form tags for discovery, e.g. `['notifications', 'slack']`. */
  tags: z.array(z.string()).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** Where the registry reads manifests from. */
export interface PluginRegistrySource {
  /** `dir`: a local folder of `*.manifest.json`; `index`: a single JSON file listing manifests. */
  kind: 'dir' | 'index';
  location: string;
}

/** A search query over the registry. All fields are ANDed; omitted fields match anything. */
export interface PluginSearchQuery {
  text?: string; // matches name/description/tags (case-insensitive substring)
  capability?: string;
  tag?: string;
}
