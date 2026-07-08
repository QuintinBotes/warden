import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { createFixtureProviders } from './index';
import type { SqlExecutor } from './providers/sql';
import type { HttpClient } from './providers/api';
import type { ContainerRuntime } from './providers/testcontainers';

const sqlExecutor: SqlExecutor = { async execute() {} };
const httpClient: HttpClient = {
  async request() {
    return { status: 200 };
  },
};
const containerRuntime: ContainerRuntime = {
  async start() {
    return { id: 'c', mappedPort: 1 };
  },
  async healthCheck() {
    return true;
  },
  async stop() {},
};

describe('createFixtureProviders', () => {
  it('enables only the backends whose collaborator is injected', () => {
    const cfg = defineConfig().fixtures;
    expect(createFixtureProviders(cfg, {})).toEqual([]);
    expect(createFixtureProviders(cfg, { sqlExecutor }).map((p) => p.backend)).toEqual(['sql']);
    expect(createFixtureProviders(cfg, { httpClient }).map((p) => p.backend)).toEqual(['api']);
  });

  it('omits the testcontainers provider unless enabled in config', () => {
    const disabled = defineConfig().fixtures;
    expect(
      createFixtureProviders(disabled, { containerRuntime, delegateFor: () => providerStub() }).map(
        (p) => p.backend,
      ),
    ).toEqual([]);

    const enabled = defineConfig({ fixtures: { testcontainers: { enabled: true } } }).fixtures;
    expect(
      createFixtureProviders(enabled, {
        sqlExecutor,
        containerRuntime,
        delegateFor: () => providerStub(),
      }).map((p) => p.backend),
    ).toEqual(['sql', 'testcontainers']);
  });
});

function providerStub() {
  return {
    backend: 'sql' as const,
    supports: () => true,
    async seed() {
      return [];
    },
    async teardown() {},
  };
}
