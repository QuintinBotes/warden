import { describe, expect, it } from 'vitest';
import type { DataProvider, FixtureDef, FixtureRecord } from '@warden/core';
import {
  TestcontainersDataProvider,
  type ContainerHandle,
  type ContainerRuntime,
} from './testcontainers';

const log: string[] = [];

function fakeRuntime(opts: { healthy: boolean | boolean[] } = { healthy: true }): ContainerRuntime {
  const health = Array.isArray(opts.healthy) ? [...opts.healthy] : null;
  return {
    async start(spec) {
      log.push(`start ${spec.image}`);
      return { id: 'c1', mappedPort: 55432, host: '127.0.0.1' };
    },
    async healthCheck() {
      log.push('healthCheck');
      if (health) return health.shift() ?? false;
      return opts.healthy as boolean;
    },
    async stop(handle: ContainerHandle) {
      log.push(`stop ${handle.id}`);
    },
  };
}

function fakeDelegate(): DataProvider & { seeded: string[]; tornDown: string[] } {
  const seeded: string[] = [];
  const tornDown: string[] = [];
  return {
    backend: 'sql',
    seeded,
    tornDown,
    supports: () => true,
    async seed(def: FixtureDef): Promise<FixtureRecord[]> {
      log.push('seed');
      seeded.push(def.id);
      return def.provides;
    },
    async teardown(def: FixtureDef) {
      log.push('teardown');
      tornDown.push(def.id);
    },
  };
}

const def: FixtureDef = {
  id: 'pg-fixture',
  appliesTo: ['@apps/checkout'],
  backend: 'testcontainers',
  seed: 'INSERT ...',
  teardown: 'DELETE ...',
  provides: [{ entity: 'customer', key: 'c', fields: { email: 'a@b.com' } }],
  container: { image: 'postgres:16', healthCheckUrl: 'tcp://localhost', port: 5432 },
};

describe('TestcontainersDataProvider', () => {
  it('starts, health-checks, then seeds — in that order', async () => {
    log.length = 0;
    const delegate = fakeDelegate();
    const provider = new TestcontainersDataProvider({
      runtime: fakeRuntime({ healthy: true }),
      delegateFor: () => delegate,
    });
    const records = await provider.seed(def, 'ns');
    expect(log).toEqual(['start postgres:16', 'healthCheck', 'seed']);
    expect(delegate.seeded).toEqual(['pg-fixture']);
    expect(records[0]!.key).toBe('c');
  });

  it('tears down the delegate before stopping the container', async () => {
    log.length = 0;
    const provider = new TestcontainersDataProvider({
      runtime: fakeRuntime({ healthy: true }),
      delegateFor: () => fakeDelegate(),
    });
    await provider.seed(def, 'ns');
    log.length = 0;
    await provider.teardown(def, 'ns');
    expect(log).toEqual(['teardown', 'stop c1']);
  });

  it('retries the health check and seeds once healthy', async () => {
    log.length = 0;
    const provider = new TestcontainersDataProvider({
      runtime: fakeRuntime({ healthy: [false, false, true] }),
      delegateFor: () => fakeDelegate(),
      sleep: async () => {},
    });
    await provider.seed(def, 'ns');
    expect(log).toEqual(['start postgres:16', 'healthCheck', 'healthCheck', 'healthCheck', 'seed']);
  });

  it('throws E_FIXTURE_CONTAINER and stops the container when health never passes', async () => {
    log.length = 0;
    const provider = new TestcontainersDataProvider({
      runtime: fakeRuntime({ healthy: false }),
      delegateFor: () => fakeDelegate(),
      healthCheckAttempts: 2,
      sleep: async () => {},
    });
    await expect(provider.seed(def, 'ns')).rejects.toMatchObject({ code: 'E_FIXTURE_CONTAINER' });
    expect(log).toContain('stop c1');
    expect(log).not.toContain('seed');
  });

  it('throws E_FIXTURE_INVALID when no container is declared', async () => {
    const provider = new TestcontainersDataProvider({
      runtime: fakeRuntime(),
      delegateFor: () => fakeDelegate(),
    });
    const { container: _c, ...noContainer } = def;
    await expect(provider.seed(noContainer as FixtureDef, 'ns')).rejects.toMatchObject({
      code: 'E_FIXTURE_INVALID',
    });
  });

  it('is a no-op teardown when nothing was seeded for the def', async () => {
    log.length = 0;
    const provider = new TestcontainersDataProvider({
      runtime: fakeRuntime(),
      delegateFor: () => fakeDelegate(),
    });
    await provider.teardown(def, 'ns');
    expect(log).toEqual([]);
  });
});
