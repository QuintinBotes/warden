import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FixtureRegistry,
  loadFixtureRegistry,
  nodeFixtureFileReader,
  parseFixtureDefs,
} from './registry';

const CHECKOUT_YAML = `
id: checkout-happy-path
appliesTo: ['@apps/checkout']
backend: sql
seed: "INSERT INTO customer(email) VALUES('primary+{{ns}}@test.warden')"
teardown: "DELETE FROM customer WHERE email = 'primary+{{ns}}@test.warden'"
provides:
  - entity: customer
    key: primaryCustomer
    fields:
      email: 'primary+{{ns}}@test.warden'
      tier: gold
`;

const AUTH_YAML = `
- id: auth-user
  appliesTo: ['@lib/auth', '@apps/checkout']
  backend: api
  seed: '{"method":"POST","path":"/users","body":{"name":"u-{{ns}}"}}'
  teardown: '{"method":"DELETE","path":"/users/u-{{ns}}"}'
  provides: []
`;

describe('parseFixtureDefs', () => {
  it('parses a single-document def', () => {
    const defs = parseFixtureDefs(CHECKOUT_YAML, 'checkout.yaml');
    expect(defs).toHaveLength(1);
    expect(defs[0]!.id).toBe('checkout-happy-path');
    expect(defs[0]!.backend).toBe('sql');
    expect(defs[0]!.provides[0]!.key).toBe('primaryCustomer');
    expect(defs[0]!.provides[0]!.fields.email).toBe('primary+{{ns}}@test.warden');
  });

  it('parses a list of defs', () => {
    const defs = parseFixtureDefs(AUTH_YAML, 'auth.yaml');
    expect(defs).toHaveLength(1);
    expect(defs[0]!.appliesTo).toEqual(['@lib/auth', '@apps/checkout']);
  });

  it('returns an empty list for empty content', () => {
    expect(parseFixtureDefs('', 'empty.yaml')).toEqual([]);
  });

  it('throws E_FIXTURE_INVALID on malformed YAML', () => {
    expect(() => parseFixtureDefs('id: [unclosed', 'bad.yaml')).toThrowError(
      expect.objectContaining({ code: 'E_FIXTURE_INVALID' }),
    );
  });

  it('throws E_FIXTURE_INVALID on a missing required field', () => {
    expect(() => parseFixtureDefs('id: x\nappliesTo: ["@a"]\nbackend: sql', 'x.yaml')).toThrowError(
      expect.objectContaining({ code: 'E_FIXTURE_INVALID' }),
    );
  });

  it('throws E_FIXTURE_INVALID on an unknown backend', () => {
    expect(() =>
      parseFixtureDefs(
        'id: x\nappliesTo: ["@a"]\nbackend: mongo\nseed: ""\nteardown: ""',
        'x.yaml',
      ),
    ).toThrowError(expect.objectContaining({ code: 'E_FIXTURE_INVALID' }));
  });
});

describe('FixtureRegistry', () => {
  it('indexes defs by every appliesTo tag', () => {
    const registry = FixtureRegistry.fromSources([
      { path: 'checkout.yaml', content: CHECKOUT_YAML },
      { path: 'auth.yaml', content: AUTH_YAML },
    ]);
    expect(registry.all()).toHaveLength(2);
    expect(registry.forTag('@lib/auth').map((d) => d.id)).toEqual(['auth-user']);
    expect(
      registry
        .forTag('@apps/checkout')
        .map((d) => d.id)
        .sort(),
    ).toEqual(['auth-user', 'checkout-happy-path']);
  });

  it('forTags returns each matching def once, in declared order', () => {
    const registry = FixtureRegistry.fromSources([
      { path: 'checkout.yaml', content: CHECKOUT_YAML },
      { path: 'auth.yaml', content: AUTH_YAML },
    ]);
    const defs = registry.forTags(['@apps/checkout', '@lib/auth']);
    expect(defs.map((d) => d.id)).toEqual(['checkout-happy-path', 'auth-user']);
  });

  it('rejects duplicate fixture ids across files', () => {
    expect(() =>
      FixtureRegistry.fromSources([
        { path: 'a.yaml', content: CHECKOUT_YAML },
        { path: 'b.yaml', content: CHECKOUT_YAML },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'E_FIXTURE_INVALID' }));
  });

  it('index() returns a defensive copy', () => {
    const registry = FixtureRegistry.fromSources([{ path: 'c.yaml', content: CHECKOUT_YAML }]);
    const idx = registry.index();
    idx.get('@apps/checkout')!.pop();
    expect(registry.forTag('@apps/checkout')).toHaveLength(1);
  });
});

describe('loadFixtureRegistry', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'warden-fixtures-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads only *.yaml/*.yml files from a directory', async () => {
    writeFileSync(join(dir, 'checkout.yaml'), CHECKOUT_YAML);
    writeFileSync(join(dir, 'auth.yml'), AUTH_YAML);
    writeFileSync(join(dir, 'README.md'), '# not a fixture');
    const registry = await loadFixtureRegistry(dir, nodeFixtureFileReader());
    expect(
      registry
        .all()
        .map((d) => d.id)
        .sort(),
    ).toEqual(['auth-user', 'checkout-happy-path']);
  });
});
