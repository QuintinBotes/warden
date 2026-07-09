import { describe, expect, it } from 'vitest';
import { WardenError, type PluginManifest } from '@warden/core';
import { resolvePlugin } from './resolve-plugin.js';

function manifest(entry: string): PluginManifest {
  return {
    name: '@acme/p',
    version: '1.0.0',
    description: '',
    entry,
    capabilities: [],
    tags: [],
  };
}

describe('resolvePlugin', () => {
  it('resolves a default-export plugin object', async () => {
    const plugin = await resolvePlugin(manifest('./p.js'), async () => ({
      default: { name: 'default-plugin' },
    }));
    expect(plugin.name).toBe('default-plugin');
  });

  it('resolves a named `plugin` export', async () => {
    const plugin = await resolvePlugin(manifest('./p.js'), async () => ({
      plugin: { name: 'named-plugin' },
    }));
    expect(plugin.name).toBe('named-plugin');
  });

  it('resolves a factory function exported as default (called with no args)', async () => {
    const plugin = await resolvePlugin(manifest('./p.js'), async () => ({
      default: () => ({ name: 'factory-plugin' }),
    }));
    expect(plugin.name).toBe('factory-plugin');
  });

  it('resolves a bare factory function module', async () => {
    const plugin = await resolvePlugin(manifest('./p.js'), async () => () => ({
      name: 'bare-factory',
    }));
    expect(plugin.name).toBe('bare-factory');
  });

  it('passes the manifest entry to the importer', async () => {
    let seen = '';
    await resolvePlugin(manifest('./entry-spec.js'), async (spec) => {
      seen = spec;
      return { name: 'x' };
    });
    expect(seen).toBe('./entry-spec.js');
  });

  it('throws WardenError E_PLUGIN_RESOLVE when the resolved value is not a plugin', async () => {
    await expect(
      resolvePlugin(manifest('./p.js'), async () => ({ default: { notName: 1 } })),
    ).rejects.toMatchObject({ code: 'E_PLUGIN_RESOLVE' });
  });

  it('throws WardenError E_PLUGIN_RESOLVE when a factory returns a non-plugin', async () => {
    await expect(
      resolvePlugin(manifest('./p.js'), async () => ({ default: () => 42 })),
    ).rejects.toMatchObject({ code: 'E_PLUGIN_RESOLVE' });
  });

  it('throws WardenError E_PLUGIN_RESOLVE when the importer throws', async () => {
    const err = await resolvePlugin(manifest('./missing.js'), async () => {
      throw new Error('module not found');
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WardenError);
    expect((err as WardenError).code).toBe('E_PLUGIN_RESOLVE');
  });
});
