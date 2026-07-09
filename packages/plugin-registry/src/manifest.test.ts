import { describe, expect, it } from 'vitest';
import { WardenError } from '@warden/core';
import { parseManifest } from './manifest.js';

const validRaw = JSON.stringify({
  name: '@acme/warden-slack',
  version: '1.0.0',
  description: 'Slack notifications',
  entry: './plugin.js',
  capabilities: ['onGateDecision'],
  tags: ['notifications', 'slack'],
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WardenError);
    return (err as WardenError).code;
  }
  throw new Error('expected parseManifest to throw');
}

describe('parseManifest', () => {
  it('parses a valid manifest into a typed PluginManifest', () => {
    const manifest = parseManifest(validRaw);
    expect(manifest.name).toBe('@acme/warden-slack');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.entry).toBe('./plugin.js');
    expect(manifest.capabilities).toEqual(['onGateDecision']);
    expect(manifest.tags).toEqual(['notifications', 'slack']);
  });

  it('applies schema defaults for omitted optional fields', () => {
    const manifest = parseManifest(
      JSON.stringify({ name: '@acme/min', version: '0.1.0', entry: './m.js' }),
    );
    expect(manifest.description).toBe('');
    expect(manifest.capabilities).toEqual([]);
    expect(manifest.tags).toEqual([]);
  });

  it('throws WardenError E_PLUGIN_MANIFEST on invalid JSON', () => {
    expect(codeOf(() => parseManifest('{ not json'))).toBe('E_PLUGIN_MANIFEST');
  });

  it('throws WardenError E_PLUGIN_MANIFEST when required fields are missing', () => {
    expect(codeOf(() => parseManifest(JSON.stringify({ version: '1', entry: './m.js' })))).toBe(
      'E_PLUGIN_MANIFEST',
    );
  });

  it('throws WardenError E_PLUGIN_MANIFEST on a wrong-typed field', () => {
    expect(
      codeOf(() =>
        parseManifest(JSON.stringify({ name: 'x', version: '1', entry: './m.js', tags: 'nope' })),
      ),
    ).toBe('E_PLUGIN_MANIFEST');
  });
});
