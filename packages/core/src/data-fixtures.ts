/**
 * Test-data management contract surface. These types describe *what data* a Test Set
 * needs before its tests run and how to remove it afterward, plus the swappable
 * {@link DataProvider} seam (config-selected, exactly like `LLMProvider`/`BrowserEngine`).
 *
 * This module is a leaf: it depends on nothing else in core and is additive — existing
 * types and signatures are untouched. The engine that implements these lives in
 * `@warden/fixtures`; every backend it drives (SQL executor, HTTP client, container
 * runtime) is injected, so the whole engine is unit-testable without any of them running.
 */

/** Which built-in seed/teardown mechanism a fixture uses. */
export type FixtureBackend = 'sql' | 'api' | 'testcontainers';

/**
 * One seed-able unit: a table/entity's rows, or an API resource, scoped to a run namespace.
 * String field values may embed the `{{ns}}` template, which a {@link DataProvider} substitutes
 * with the run namespace so parallel runs never collide.
 */
export interface FixtureRecord {
  /** e.g. `"customer"`, `"order"`. */
  entity: string;
  /** Stable handle a test/agent references, e.g. `"primaryCustomer"`. */
  key: string;
  fields: Record<string, string | number | boolean | null>;
}

/** For a `testcontainers` fixture: the image + health check + port to seed into. */
export interface FixtureContainerSpec {
  image: string;
  healthCheckUrl?: string;
  port: number;
}

/** A declarative fixture definition, typically authored in `tests/fixtures/*.yaml`. */
export interface FixtureDef {
  /** e.g. `"checkout-happy-path"`. */
  id: string;
  /** Test Set tags this fixture applies to, matching `TestCase.tags` (e.g. `'@apps/checkout'`). */
  appliesTo: string[];
  backend: FixtureBackend;
  /** SQL script (sql), request template (api), or seed payload (testcontainers). */
  seed: string;
  teardown: string;
  /** Declares the records this fixture makes available, for the fixture catalog / agents. */
  provides: FixtureRecord[];
  /** For `testcontainers`: the image + health check + port to seed into. */
  container?: FixtureContainerSpec;
}

/** What a run asks the fixture engine to resolve: the tier's tags + this run's namespace. */
export interface FixtureCatalogRequest {
  /** From `ChangeSurface.testTags` / a TestPlan's tags. */
  testTags: string[];
  /** From `RunNamespace`. */
  namespace: string;
}

/** The resolved, run-scoped data a test run (and the agents) can use. */
export interface FixtureCatalog {
  namespace: string;
  /** Fields already namespaced (e.g. an email includes the namespace). */
  records: FixtureRecord[];
  /** Resolve a record by its declared key, e.g. `catalog.get('primaryCustomer')`. */
  get(key: string): FixtureRecord | undefined;
}

/**
 * The swappable data-provisioning seam. Each implementation seeds a {@link FixtureDef} into a
 * concrete backend (SQL, API, or a Testcontainers-backed service) and tears it back down.
 */
export interface DataProvider {
  backend: FixtureBackend;
  supports(def: FixtureDef): boolean;
  seed(def: FixtureDef, namespace: string): Promise<FixtureRecord[]>;
  teardown(def: FixtureDef, namespace: string): Promise<void>;
}

/**
 * Builds a {@link FixtureCatalog} with a working `get()` over a set of already-namespaced
 * records. When two records share a key, the last one wins (mirrors object-spread semantics).
 */
export function createFixtureCatalog(namespace: string, records: FixtureRecord[]): FixtureCatalog {
  const byKey = new Map<string, FixtureRecord>();
  for (const record of records) byKey.set(record.key, record);
  return {
    namespace,
    records,
    get(key: string): FixtureRecord | undefined {
      return byKey.get(key);
    },
  };
}
