import { SqliteStore } from '@warden/test-management';
import type { TenantRef } from '@warden/core';

/**
 * Lazily opens and caches one {@link SqliteStore} per tenant id; never shares a handle across
 * tenants, so store-level isolation is structural rather than filter-based.
 */
export interface TenantStoreRegistry {
  storeFor(tenant: TenantRef): SqliteStore;
}

export interface CreateTenantStoreRegistryOptions {
  /** Resolves each tenant to its own SQLite file path (or `':memory:'`). */
  dbPathFor: (tenant: TenantRef) => string;
}

export function createTenantStoreRegistry(
  opts: CreateTenantStoreRegistryOptions,
): TenantStoreRegistry {
  const cache = new Map<string, SqliteStore>();
  return {
    storeFor(tenant: TenantRef): SqliteStore {
      const cached = cache.get(tenant.id);
      if (cached) return cached;
      const store = new SqliteStore(opts.dbPathFor(tenant));
      cache.set(tenant.id, store);
      return store;
    },
  };
}
