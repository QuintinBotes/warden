import { describe, expect, it } from 'vitest';
import { createFixtureCatalog, type FixtureRecord } from './data-fixtures';
import { defineConfig } from './config';

const records: FixtureRecord[] = [
  { entity: 'customer', key: 'primaryCustomer', fields: { email: 'primary+ns@test.warden' } },
  { entity: 'order', key: 'openOrder', fields: { id: 'ORD-ns-1', status: 'pending' } },
];

describe('createFixtureCatalog', () => {
  it('exposes the namespace and records verbatim', () => {
    const catalog = createFixtureCatalog('pr482-sel-a1b2', records);
    expect(catalog.namespace).toBe('pr482-sel-a1b2');
    expect(catalog.records).toEqual(records);
  });

  it('resolves records by their declared key', () => {
    const catalog = createFixtureCatalog('ns', records);
    expect(catalog.get('primaryCustomer')?.fields.email).toBe('primary+ns@test.warden');
    expect(catalog.get('openOrder')?.entity).toBe('order');
  });

  it('returns undefined for an unknown key', () => {
    const catalog = createFixtureCatalog('ns', records);
    expect(catalog.get('missing')).toBeUndefined();
  });

  it('last write wins when two records share a key', () => {
    const catalog = createFixtureCatalog('ns', [
      { entity: 'customer', key: 'dup', fields: { v: 1 } },
      { entity: 'customer', key: 'dup', fields: { v: 2 } },
    ]);
    expect(catalog.get('dup')?.fields.v).toBe(2);
  });
});

describe('fixtures config block', () => {
  it('defaults to disabled with documented defaults', () => {
    const cfg = defineConfig();
    expect(cfg.fixtures.enabled).toBe(false);
    expect(cfg.fixtures.dir).toBe('tests/fixtures/');
    expect(cfg.fixtures.defaultBackend).toBe('sql');
    expect(cfg.fixtures.namespaceStrategy).toBe('per-run');
    expect(cfg.fixtures.sql.connectionEnvVar).toBe('WARDEN_FIXTURES_DB_URL');
    expect(cfg.fixtures.api.baseUrlEnvVar).toBe('WARDEN_FIXTURES_API_URL');
    expect(cfg.fixtures.api.authHeaderEnvVar).toBe('WARDEN_FIXTURES_API_TOKEN');
    expect(cfg.fixtures.testcontainers.enabled).toBe(false);
    expect(cfg.fixtures.testcontainers.reuseAcrossShards).toBe(false);
    expect(cfg.fixtures.teardown.onFailure).toBe('always');
    expect(cfg.fixtures.teardown.timeoutMs).toBe(30000);
  });

  it('accepts overrides and validates enums', () => {
    const cfg = defineConfig({
      fixtures: { enabled: true, defaultBackend: 'api', teardown: { onFailure: 'onSuccessOnly' } },
    });
    expect(cfg.fixtures.enabled).toBe(true);
    expect(cfg.fixtures.defaultBackend).toBe('api');
    expect(cfg.fixtures.teardown.onFailure).toBe('onSuccessOnly');
  });
});
