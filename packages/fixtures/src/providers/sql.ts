import type { DataProvider, FixtureDef, FixtureRecord } from '@warden/core';
import { namespaceRecords, renderTemplate } from '../template';

/**
 * `SqlDataProvider` — a {@link DataProvider} that runs a namespaced seed script (`{{ns}}` template)
 * via an injected {@link SqlExecutor}, and the paired teardown script on cleanup. It never opens a
 * real connection itself: the executor is injected, so this is unit-testable with a recording fake.
 */

/** The one capability the SQL provider needs from a database driver. */
export interface SqlExecutor {
  /** Runs a (possibly multi-statement) SQL script. */
  execute(sql: string): Promise<void>;
}

export class SqlDataProvider implements DataProvider {
  readonly backend = 'sql' as const;

  constructor(private readonly executor: SqlExecutor) {}

  supports(def: FixtureDef): boolean {
    return def.backend === 'sql';
  }

  async seed(def: FixtureDef, namespace: string): Promise<FixtureRecord[]> {
    await this.executor.execute(renderTemplate(def.seed, namespace));
    return namespaceRecords(def.provides, namespace);
  }

  async teardown(def: FixtureDef, namespace: string): Promise<void> {
    await this.executor.execute(renderTemplate(def.teardown, namespace));
  }
}
