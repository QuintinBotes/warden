import {
  WardenError,
  type DataProvider,
  type FixtureContainerSpec,
  type FixtureDef,
  type FixtureRecord,
} from '@warden/core';

/**
 * `TestcontainersDataProvider` — a {@link DataProvider} that starts a declared container image (via
 * an injected {@link ContainerRuntime}), waits for its health check, then delegates the actual
 * seeding to an inner provider (SQL/API) bound to the container's mapped port, and stops the
 * container on cleanup. The Docker daemon is never touched directly: the runtime and the delegate
 * factory are injected, so ordering (start → health-check → seed, teardown → stop) is unit-testable.
 */

/** A handle to a started container, carrying the host port the delegate should seed into. */
export interface ContainerHandle {
  id: string;
  mappedPort: number;
  host?: string;
}

/** The lifecycle the provider needs from a container runtime. */
export interface ContainerRuntime {
  start(spec: FixtureContainerSpec): Promise<ContainerHandle>;
  /** Returns `true` when the container is ready to be seeded. */
  healthCheck(handle: ContainerHandle, url?: string): Promise<boolean>;
  stop(handle: ContainerHandle): Promise<void>;
}

export interface TestcontainersProviderOptions {
  runtime: ContainerRuntime;
  /** Builds the inner provider that seeds into the started container (bound to its mapped port). */
  delegateFor: (handle: ContainerHandle, def: FixtureDef) => DataProvider;
  /** How many times to poll the health check before giving up. Defaults to 10. */
  healthCheckAttempts?: number;
  /** Delay between health-check polls. Injected in tests so they never actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds between health-check polls. Defaults to 500. */
  healthCheckIntervalMs?: number;
}

async function safeStop(runtime: ContainerRuntime, handle: ContainerHandle): Promise<void> {
  try {
    await runtime.stop(handle);
  } catch {
    // Best-effort cleanup on the failure path; the original error is what matters.
  }
}

export class TestcontainersDataProvider implements DataProvider {
  readonly backend = 'testcontainers' as const;

  private readonly started = new Map<string, { handle: ContainerHandle; delegate: DataProvider }>();

  constructor(private readonly options: TestcontainersProviderOptions) {}

  supports(def: FixtureDef): boolean {
    return def.backend === 'testcontainers';
  }

  async seed(def: FixtureDef, namespace: string): Promise<FixtureRecord[]> {
    if (!def.container) {
      throw new WardenError(
        `fixture "${def.id}" uses the testcontainers backend but declares no container`,
        'E_FIXTURE_INVALID',
      );
    }
    const { runtime } = this.options;
    const handle = await runtime.start(def.container);

    const attempts = this.options.healthCheckAttempts ?? 10;
    const interval = this.options.healthCheckIntervalMs ?? 500;
    const sleep =
      this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    let healthy = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      healthy = await runtime.healthCheck(handle, def.container.healthCheckUrl);
      if (healthy) break;
      if (attempt < attempts - 1) await sleep(interval);
    }
    if (!healthy) {
      await safeStop(runtime, handle);
      throw new WardenError(
        `fixture "${def.id}" container ${def.container.image} failed its health check`,
        'E_FIXTURE_CONTAINER',
      );
    }

    const delegate = this.options.delegateFor(handle, def);
    let records: FixtureRecord[];
    try {
      records = await delegate.seed(def, namespace);
    } catch (err) {
      await safeStop(runtime, handle);
      throw err;
    }
    this.started.set(def.id, { handle, delegate });
    return records;
  }

  async teardown(def: FixtureDef, namespace: string): Promise<void> {
    const entry = this.started.get(def.id);
    if (!entry) return;
    this.started.delete(def.id);
    try {
      await entry.delegate.teardown(def, namespace);
    } finally {
      await this.options.runtime.stop(entry.handle);
    }
  }
}
