import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFixtureCatalog,
  createLogger,
  defineConfig,
  type CTRFReport,
  type FixtureCatalogRequest,
  type LogEntry,
} from '@warden/core';
import { runRun, type FixtureRun, type RunFixtures } from './run-run';

function fixtureCtrf(): CTRFReport {
  return {
    results: {
      tool: { name: 'playwright' },
      summary: {
        tests: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 1,
      },
      tests: [{ name: 'smoke: home page loads', status: 'passed', duration: 10 }],
    },
  };
}

/** A recording fake orchestrator that structurally satisfies {@link RunFixtures}. */
function fakeOrchestrator(
  opts: { teardownErrors?: { fixtureId: string; message: string }[] } = {},
) {
  const calls: string[] = [];
  const orchestrator: RunFixtures = {
    async seed(request: FixtureCatalogRequest) {
      calls.push('seed');
      return createFixtureCatalog(request.namespace, [
        {
          entity: 'customer',
          key: 'primaryCustomer',
          fields: { email: `primary+${request.namespace}@test.warden` },
        },
      ]);
    },
    async teardown() {
      calls.push('teardown');
      return { errors: opts.teardownErrors ?? [] };
    },
  };
  return { orchestrator, calls };
}

function fixtureRun(orchestrator: RunFixtures): FixtureRun {
  return {
    orchestrator,
    request: { testTags: ['@apps/checkout'], namespace: 'pr482-selective-a1b2' },
  };
}

describe('runRun fixtures integration', () => {
  let artifactsDir: string;
  beforeEach(async () => {
    artifactsDir = await fs.mkdtemp(path.join(tmpdir(), 'warden-fixtures-run-'));
  });
  afterEach(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  it('seeds before the run, writes fixture-catalog.json, then tears down', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const order: string[] = [];
    await runRun(
      { artifactsDir, grep: '@smoke' },
      {
        config: defineConfig(),
        reporters: [],
        fixtures: fixtureRun(orchestrator),
        runTests: async () => {
          order.push('runTests');
          return fixtureCtrf();
        },
      },
    );

    // seed happened before the test run, teardown after
    expect(calls[0]).toBe('seed');
    expect(order).toEqual(['runTests']);
    expect(calls).toEqual(['seed', 'teardown']);

    const catalogRaw = await fs.readFile(path.join(artifactsDir, 'fixture-catalog.json'), 'utf-8');
    const catalog = JSON.parse(catalogRaw);
    expect(catalog.namespace).toBe('pr482-selective-a1b2');
    expect(catalog.records[0].fields.email).toBe('primary+pr482-selective-a1b2@test.warden');
  });

  it('still tears down when the test run throws, and propagates the error', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const boom = new Error('runner exploded');
    await expect(
      runRun(
        { artifactsDir },
        {
          config: defineConfig(),
          reporters: [],
          fixtures: fixtureRun(orchestrator),
          runTests: async () => {
            throw boom;
          },
        },
      ),
    ).rejects.toBe(boom);

    expect(calls).toEqual(['seed', 'teardown']);
  });

  it('surfaces teardown errors as a WARN and on the result, never blocking the gate', async () => {
    const { orchestrator } = fakeOrchestrator({
      teardownErrors: [{ fixtureId: 'checkout', message: 'connection lost' }],
    });
    const warnings: LogEntry[] = [];
    const logger = createLogger({ sink: (e) => e.level === 'warn' && warnings.push(e) });

    const res = await runRun(
      { artifactsDir },
      {
        config: defineConfig(),
        reporters: [],
        fixtures: fixtureRun(orchestrator),
        logger,
        runTests: async () => fixtureCtrf(),
      },
    );

    expect(res.gate.decision).toBe('PASS');
    expect(res.fixtureTeardownErrors).toEqual([
      { fixtureId: 'checkout', message: 'connection lost' },
    ]);
    expect(warnings.some((w) => w.message.includes('checkout: connection lost'))).toBe(true);
  });

  it('behaves exactly as before when no fixtures are injected', async () => {
    const res = await runRun(
      { artifactsDir },
      { config: defineConfig(), reporters: [], runTests: async () => fixtureCtrf() },
    );
    expect(res.fixtureTeardownErrors).toBeUndefined();
    await expect(fs.access(path.join(artifactsDir, 'fixture-catalog.json'))).rejects.toBeDefined();
  });
});
