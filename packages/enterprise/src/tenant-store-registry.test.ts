import { describe, it, expect } from 'vitest';
import { SqliteStore } from '@warden/test-management';
import type { TenantRef } from '@warden/core';
import { createTenantStoreRegistry } from './tenant-store-registry.js';

const tenantA: TenantRef = { id: 'acme', name: 'Acme' };
const tenantB: TenantRef = { id: 'globex', name: 'Globex' };

describe('createTenantStoreRegistry', () => {
  it('opens a distinct SqliteStore per tenant, never sharing a handle', () => {
    const registry = createTenantStoreRegistry({ dbPathFor: () => ':memory:' });
    const storeA = registry.storeFor(tenantA);
    const storeB = registry.storeFor(tenantB);

    expect(storeA).toBeInstanceOf(SqliteStore);
    expect(storeB).toBeInstanceOf(SqliteStore);
    expect(storeA).not.toBe(storeB); // per-tenant isolation is structural
  });

  it('lazily caches: the same tenant resolves to the same store instance', () => {
    let opened = 0;
    const registry = createTenantStoreRegistry({
      dbPathFor: () => {
        opened += 1;
        return ':memory:';
      },
    });
    const first = registry.storeFor(tenantA);
    const second = registry.storeFor(tenantA);
    expect(first).toBe(second);
    expect(opened).toBe(1); // opened once, then served from cache
  });
});
