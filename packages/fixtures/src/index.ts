/**
 * `@warden/fixtures` — the test-data management engine. It gives every Test Set declarative,
 * isolated seed/teardown data (via SQL, an API call, or a Testcontainers-backed service) plus a
 * per-run namespace so parallel executions never collide, and exposes the resolved
 * {@link FixtureCatalog} to the exploratory/generative agents.
 *
 * Every backend (SQL executor, HTTP client, container runtime) is injected, so the whole engine is
 * unit-testable without a live database, HTTP endpoint, or Docker daemon.
 */

import type { DataProvider, FixtureDef, WardenConfig } from '@warden/core';
import { SqlDataProvider, type SqlExecutor } from './providers/sql';
import { ApiDataProvider, type ApiProviderOptions, type HttpClient } from './providers/api';
import {
  TestcontainersDataProvider,
  type ContainerHandle,
  type ContainerRuntime,
} from './providers/testcontainers';

// Namespace derivation
export { deriveNamespace, type NamespaceInput } from './namespace';

// Registry (load / parse / tag-index)
export {
  FixtureRegistry,
  parseFixtureDefs,
  loadFixtureRegistry,
  nodeFixtureFileReader,
  type FixtureSource,
  type FixtureFileReader,
} from './registry';

// Namespace templating + lint helpers
export {
  renderTemplate,
  referencesNamespace,
  namespaceRecords,
  lintFixtureNamespace,
} from './template';

// Providers
export { SqlDataProvider, type SqlExecutor } from './providers/sql';
export {
  ApiDataProvider,
  type ApiProviderOptions,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from './providers/api';
export {
  TestcontainersDataProvider,
  type TestcontainersProviderOptions,
  type ContainerRuntime,
  type ContainerHandle,
} from './providers/testcontainers';

// Orchestrator
export {
  FixtureOrchestrator,
  detectFixtureCycles,
  type FixtureOrchestratorDeps,
  type FixtureTeardownError,
  type FixtureTeardownReport,
} from './orchestrator';

// Catalog reader (prompt-ready summary)
export {
  renderFixtureCatalog,
  DEFAULT_CATALOG_SUMMARY_CAP,
  type CatalogSummaryOptions,
} from './catalog-reader';

/** Injected backends the provider factory wires into `DataProvider`s. */
export interface FixtureProviderDeps {
  /** Enables {@link SqlDataProvider} when present. */
  sqlExecutor?: SqlExecutor;
  /** Enables {@link ApiDataProvider} when present. */
  httpClient?: HttpClient;
  /** Non-secret API wiring (base url + resolved auth header) for {@link ApiDataProvider}. */
  apiOptions?: ApiProviderOptions;
  /** Enables {@link TestcontainersDataProvider} when present and `cfg.testcontainers.enabled`. */
  containerRuntime?: ContainerRuntime;
  /** Builds the inner provider a Testcontainers fixture seeds into (bound to its mapped port). */
  delegateFor?: (handle: ContainerHandle, def: FixtureDef) => DataProvider;
}

/**
 * Builds the ordered list of `DataProvider`s from config + injected backends (mirrors
 * `createEngine`/`createProvider` in the other packages). Only backends whose collaborator is
 * injected are enabled, so the factory never assumes a live database/HTTP/Docker is present; the
 * Testcontainers provider additionally requires `cfg.testcontainers.enabled`.
 */
export function createFixtureProviders(
  cfg: WardenConfig['fixtures'],
  deps: FixtureProviderDeps,
): DataProvider[] {
  const providers: DataProvider[] = [];
  if (deps.sqlExecutor) providers.push(new SqlDataProvider(deps.sqlExecutor));
  if (deps.httpClient) providers.push(new ApiDataProvider(deps.httpClient, deps.apiOptions));
  if (cfg.testcontainers.enabled && deps.containerRuntime && deps.delegateFor) {
    providers.push(
      new TestcontainersDataProvider({
        runtime: deps.containerRuntime,
        delegateFor: deps.delegateFor,
      }),
    );
  }
  return providers;
}
