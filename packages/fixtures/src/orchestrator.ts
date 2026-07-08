import {
  createFixtureCatalog,
  WardenError,
  type DataProvider,
  type FixtureCatalog,
  type FixtureCatalogRequest,
  type FixtureDef,
  type FixtureRecord,
} from '@warden/core';
import type { FixtureRegistry } from './registry';

/**
 * `FixtureOrchestrator` — resolves which fixtures a Test Set needs, seeds them in declared order
 * against the configured providers, and builds the resolved {@link FixtureCatalog}. `teardown()`
 * runs teardown in reverse seed order and **never throws**: per-fixture errors are collected into a
 * {@link FixtureTeardownReport} so a cleanup failure can never mask or block the test result.
 */

export interface FixtureTeardownError {
  fixtureId: string;
  message: string;
}

export interface FixtureTeardownReport {
  errors: FixtureTeardownError[];
}

export interface FixtureOrchestratorDeps {
  registry: FixtureRegistry;
  providers: DataProvider[];
}

/**
 * Detects dependency cycles between fixtures. A def depends on another when its seed template
 * references a `{{key}}` token owned by another def's `provides` (the `{{ns}}` token is ignored).
 * A cycle is rejected up-front with `E_FIXTURE_CYCLE` rather than deadlocking at seed time.
 */
export function detectFixtureCycles(defs: FixtureDef[]): void {
  const keyOwner = new Map<string, string>();
  for (const def of defs) {
    for (const record of def.provides) keyOwner.set(record.key, def.id);
  }

  const edges = new Map<string, Set<string>>();
  for (const def of defs) {
    const deps = new Set<string>();
    const tokens = def.seed.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) ?? [];
    for (const token of tokens) {
      const key = token.replace(/[{}]/g, '').trim();
      if (key === 'ns') continue;
      const owner = keyOwner.get(key);
      if (owner && owner !== def.id) deps.add(owner);
    }
    edges.set(def.id, deps);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const def of defs) color.set(def.id, WHITE);
  const stack: string[] = [];

  const visit = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of edges.get(id) ?? []) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const from = stack.indexOf(dep);
        const cycle = [...stack.slice(from), dep].join(' -> ');
        throw new WardenError(`fixture dependency cycle detected: ${cycle}`, 'E_FIXTURE_CYCLE');
      }
      if (c === WHITE) visit(dep);
    }
    color.set(id, BLACK);
    stack.pop();
  };

  for (const def of defs) {
    if (color.get(def.id) === WHITE) visit(def.id);
  }
}

export class FixtureOrchestrator {
  private readonly seeded: { def: FixtureDef; provider: DataProvider; namespace: string }[] = [];

  constructor(private readonly deps: FixtureOrchestratorDeps) {}

  /** Selects (and validates) the fixtures whose `appliesTo` intersects `testTags`. */
  resolve(testTags: string[]): FixtureDef[] {
    const defs = this.deps.registry.forTags(testTags);
    detectFixtureCycles(defs);
    return defs;
  }

  /**
   * Seeds every resolved fixture in declared order, recording each seeded (def, provider) pair so
   * {@link teardown} can reverse it. Returns the resolved, namespaced {@link FixtureCatalog}. If a
   * provider throws mid-seed the error propagates (so the caller can mark the tier BLOCKED); the
   * fixtures that already seeded are still torn down when the caller invokes {@link teardown}.
   */
  async seed(request: FixtureCatalogRequest): Promise<FixtureCatalog> {
    const defs = this.resolve(request.testTags);
    const records: FixtureRecord[] = [];
    for (const def of defs) {
      const provider = this.providerFor(def);
      const seeded = await provider.seed(def, request.namespace);
      this.seeded.push({ def, provider, namespace: request.namespace });
      records.push(...seeded);
    }
    return createFixtureCatalog(request.namespace, records);
  }

  /** Tears down every seeded fixture in reverse order, collecting (never throwing) errors. */
  async teardown(): Promise<FixtureTeardownReport> {
    const errors: FixtureTeardownError[] = [];
    for (let i = this.seeded.length - 1; i >= 0; i--) {
      const entry = this.seeded[i];
      if (!entry) continue;
      try {
        await entry.provider.teardown(entry.def, entry.namespace);
      } catch (err) {
        errors.push({ fixtureId: entry.def.id, message: (err as Error).message });
      }
    }
    this.seeded.length = 0;
    return { errors };
  }

  private providerFor(def: FixtureDef): DataProvider {
    const provider = this.deps.providers.find((p) => p.supports(def));
    if (!provider) {
      throw new WardenError(
        `no DataProvider supports fixture "${def.id}" (backend "${def.backend}")`,
        'E_FIXTURE_NO_PROVIDER',
      );
    }
    return provider;
  }
}
