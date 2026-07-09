import { PluginManifestSchema, WardenError, type PluginManifest } from '@warden/core';

/** Stable error code thrown when a plugin manifest cannot be parsed or fails validation. */
export const E_PLUGIN_MANIFEST = 'E_PLUGIN_MANIFEST';

/**
 * Parse a raw JSON string into a validated {@link PluginManifest}.
 *
 * Throws a {@link WardenError} with code {@link E_PLUGIN_MANIFEST} when the string is not
 * valid JSON or when the parsed value does not satisfy `PluginManifestSchema`.
 */
export function parseManifest(raw: string): PluginManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new WardenError(
      `Invalid plugin manifest JSON: ${(err as Error).message}`,
      E_PLUGIN_MANIFEST,
    );
  }
  const result = PluginManifestSchema.safeParse(value);
  if (!result.success) {
    throw new WardenError(`Invalid plugin manifest: ${result.error.message}`, E_PLUGIN_MANIFEST);
  }
  return result.data;
}
