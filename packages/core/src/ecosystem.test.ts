import { describe, it, expect } from 'vitest';
import { defineConfig } from './config';
import { PluginManifestSchema } from './plugin-manifest';
import type { ShareTokenPayload, ShareTokenSigner } from './share';
import type { PluginManifest, PluginSearchQuery } from './plugin-manifest';

describe('ecosystem config', () => {
  it('defaults results service + plugin registry off', () => {
    const cfg = defineConfig({});
    expect(cfg.resultsService.enabled).toBe(false);
    expect(cfg.resultsService.tokenTtlSec).toBe(604800);
    expect(cfg.pluginRegistry.enabled).toBe(false);
    expect(cfg.pluginRegistry.sources).toEqual([]);
  });

  it('accepts registry sources', () => {
    const cfg = defineConfig({
      pluginRegistry: { enabled: true, sources: [{ kind: 'dir', location: 'plugins/' }] },
    });
    expect(cfg.pluginRegistry.sources[0]?.kind).toBe('dir');
  });
});

describe('plugin manifest schema', () => {
  it('validates + fills defaults', () => {
    const m = PluginManifestSchema.parse({
      name: '@acme/warden-slack',
      version: '1.0.0',
      entry: './dist/index.js',
    });
    expect(m.description).toBe('');
    expect(m.capabilities).toEqual([]);
    expect(m.tags).toEqual([]);
  });

  it('rejects a manifest missing an entry', () => {
    expect(() => PluginManifestSchema.parse({ name: 'x', version: '1' })).toThrow();
  });
});

describe('ecosystem types', () => {
  it('models a share token payload + a manifest search', () => {
    const payload: ShareTokenPayload = {
      executionId: 'ex-1',
      scope: 'run',
      issuedAt: 0,
      expiresAt: 1000,
    };
    const q: PluginSearchQuery = { capability: 'onGateDecision', tag: 'notifications' };
    const signer: Partial<ShareTokenSigner> = {};
    const manifest: PluginManifest = {
      name: 'x',
      version: '1',
      description: '',
      entry: 'x',
      capabilities: [],
      tags: [],
    };
    expect(payload.scope).toBe('run');
    expect(q.capability).toBe('onGateDecision');
    expect(manifest.name).toBe('x');
    expect(signer.sign).toBeUndefined();
  });
});
