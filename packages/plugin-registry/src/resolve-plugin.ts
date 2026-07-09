import { WardenError, type PluginManifest, type QAPlatformPlugin } from '@warden/core';

/** Stable error code thrown when a manifest's entry cannot be resolved to a plugin. */
export const E_PLUGIN_RESOLVE = 'E_PLUGIN_RESOLVE';

/**
 * Resolve a {@link PluginManifest} into a live {@link QAPlatformPlugin} by dynamically importing
 * its `entry` through the injected `importer`.
 *
 * The imported module may expose the plugin as a default export, a named `plugin` export, or a
 * bare module value; any of those may itself be a factory function, which is called with no
 * arguments to produce the plugin. The result must look like a `QAPlatformPlugin` (a `string`
 * `name`); otherwise a {@link WardenError} with code {@link E_PLUGIN_RESOLVE} is thrown. Import
 * failures are also wrapped as `E_PLUGIN_RESOLVE`.
 */
export async function resolvePlugin(
  manifest: PluginManifest,
  importer: (spec: string) => Promise<unknown>,
): Promise<QAPlatformPlugin> {
  let module: unknown;
  try {
    module = await importer(manifest.entry);
  } catch (err) {
    throw new WardenError(
      `Failed to import plugin entry "${manifest.entry}" for "${manifest.name}": ${(err as Error).message}`,
      E_PLUGIN_RESOLVE,
    );
  }

  const exported = pickExport(module);
  const candidate = typeof exported === 'function' ? exported() : exported;

  if (!isQAPlatformPlugin(candidate)) {
    throw new WardenError(
      `Plugin entry "${manifest.entry}" for "${manifest.name}" did not resolve to a QAPlatformPlugin`,
      E_PLUGIN_RESOLVE,
    );
  }
  return candidate;
}

/** Prefer a `default` export, then a named `plugin` export, else the module value itself. */
function pickExport(module: unknown): unknown {
  if (isRecord(module)) {
    if (module.default !== undefined) return module.default;
    if (module.plugin !== undefined) return module.plugin;
  }
  return module;
}

function isQAPlatformPlugin(value: unknown): value is QAPlatformPlugin {
  return isRecord(value) && typeof value.name === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
