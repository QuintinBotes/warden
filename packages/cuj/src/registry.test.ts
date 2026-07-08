import { describe, it, expect } from 'vitest';
import { CujRegistry } from './registry.js';
import { memCujSource } from './testing-fakes.js';

// The fake source serves JSON text; JSON is a strict subset of YAML, so `JSON.parse` (the
// registry's default injected parser) reads these fixtures exactly as a YAML parser would.
const checkout = JSON.stringify({
  id: 'CUJ-checkout',
  name: 'Guest checkout',
  owningTeam: 'payments',
  tags: ['@apps/checkout'],
  steps: [{ order: 1, name: 'Pay', module: '@apps/checkout', testIds: ['TC-pay'] }],
});
const signin = JSON.stringify({
  id: 'CUJ-signin',
  name: 'Sign in',
  owningTeam: 'identity',
  tags: ['@apps/auth'],
});

describe('CujRegistry', () => {
  it('loads, validates, and tag-indexes valid CUJ files', async () => {
    const registry = new CujRegistry(
      memCujSource({ 'checkout.yaml': checkout, 'signin.yml': signin }),
    );
    const result = await registry.load('.warden/cuj/');

    expect(result.cujs.map((c) => c.id).sort()).toEqual(['CUJ-checkout', 'CUJ-signin']);
    expect(result.errors).toEqual([]);
    expect(result.byId.get('CUJ-checkout')!.name).toBe('Guest checkout');
    // indexed by top-level tag AND by step module
    expect(result.byTag.get('@apps/checkout')!.map((c) => c.id)).toEqual(['CUJ-checkout']);
    expect(result.byTag.get('@apps/auth')!.map((c) => c.id)).toEqual(['CUJ-signin']);
  });

  it('skips a malformed file with an E_CUJ_INVALID error while valid ones still load', async () => {
    const registry = new CujRegistry(
      memCujSource({
        'good.yaml': checkout,
        'bad.yaml': JSON.stringify({ name: 'missing id and owningTeam' }),
      }),
    );
    const result = await registry.load('.warden/cuj/');

    expect(result.cujs.map((c) => c.id)).toEqual(['CUJ-checkout']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('E_CUJ_INVALID');
    expect(result.errors[0]!.message).toContain('bad.yaml');
  });

  it('ignores non-YAML files', async () => {
    const registry = new CujRegistry(
      memCujSource({ 'checkout.yaml': checkout, 'README.md': '# not a cuj' }),
    );
    const result = await registry.load('.warden/cuj/');
    expect(result.cujs).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('reports a duplicate CUJ id as E_CUJ_INVALID', async () => {
    const registry = new CujRegistry(memCujSource({ 'a.yaml': checkout, 'b.yaml': checkout }));
    const result = await registry.load('.warden/cuj/');
    expect(result.cujs).toHaveLength(1);
    expect(result.errors[0]!.code).toBe('E_CUJ_INVALID');
    expect(result.errors[0]!.message).toContain('Duplicate');
  });
});
