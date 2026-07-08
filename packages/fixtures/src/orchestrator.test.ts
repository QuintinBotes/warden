import { describe, expect, it } from 'vitest';
import type { DataProvider, FixtureBackend, FixtureDef, FixtureRecord } from '@warden/core';
import { FixtureOrchestrator, detectFixtureCycles } from './orchestrator';
import { FixtureRegistry } from './registry';

interface RecordingProvider extends DataProvider {
  seeds: string[];
  teardowns: string[];
}

function recordingProvider(
  backend: FixtureBackend,
  order: string[],
  opts: { failTeardownFor?: string } = {},
): RecordingProvider {
  const seeds: string[] = [];
  const teardowns: string[] = [];
  return {
    backend,
    seeds,
    teardowns,
    supports: (def) => def.backend === backend,
    async seed(def: FixtureDef, namespace: string): Promise<FixtureRecord[]> {
      order.push(`seed ${def.id}`);
      seeds.push(def.id);
      return def.provides.map((r) => ({
        entity: r.entity,
        key: r.key,
        fields: { ...r.fields, ns: namespace },
      }));
    },
    async teardown(def: FixtureDef) {
      order.push(`teardown ${def.id}`);
      teardowns.push(def.id);
      if (opts.failTeardownFor === def.id) {
        throw new Error(`teardown boom for ${def.id}`);
      }
    },
  };
}

function registryOf(...defs: Partial<FixtureDef>[]): FixtureRegistry {
  return new FixtureRegistry(
    defs.map((d, i) => ({
      id: d.id ?? `f${i}`,
      appliesTo: d.appliesTo ?? ['@apps/checkout'],
      backend: d.backend ?? 'sql',
      seed: d.seed ?? 'INSERT',
      teardown: d.teardown ?? 'DELETE',
      provides: d.provides ?? [],
      ...(d.container ? { container: d.container } : {}),
    })),
  );
}

describe('FixtureOrchestrator.seed', () => {
  it('seeds resolved fixtures in declared order and builds a namespaced catalog', async () => {
    const order: string[] = [];
    const registry = registryOf(
      {
        id: 'a',
        provides: [{ entity: 'customer', key: 'primary', fields: { email: 'a@b.com' } }],
      },
      { id: 'b', provides: [{ entity: 'order', key: 'open', fields: { total: 10 } }] },
    );
    const orchestrator = new FixtureOrchestrator({
      registry,
      providers: [recordingProvider('sql', order)],
    });

    const catalog = await orchestrator.seed({ testTags: ['@apps/checkout'], namespace: 'ns1' });
    expect(order).toEqual(['seed a', 'seed b']);
    expect(catalog.namespace).toBe('ns1');
    expect(catalog.get('primary')?.fields.ns).toBe('ns1');
    expect(catalog.get('open')?.entity).toBe('order');
  });

  it('picks a provider by backend and throws E_FIXTURE_NO_PROVIDER when none matches', async () => {
    const registry = registryOf({ id: 'a', backend: 'api' });
    const orchestrator = new FixtureOrchestrator({
      registry,
      providers: [recordingProvider('sql', [])],
    });
    await expect(
      orchestrator.seed({ testTags: ['@apps/checkout'], namespace: 'ns' }),
    ).rejects.toMatchObject({ code: 'E_FIXTURE_NO_PROVIDER' });
  });

  it('ignores fixtures whose tags do not intersect the request', async () => {
    const order: string[] = [];
    const registry = registryOf(
      { id: 'a', appliesTo: ['@apps/checkout'] },
      { id: 'b', appliesTo: ['@lib/auth'] },
    );
    const orchestrator = new FixtureOrchestrator({
      registry,
      providers: [recordingProvider('sql', order)],
    });
    await orchestrator.seed({ testTags: ['@apps/checkout'], namespace: 'ns' });
    expect(order).toEqual(['seed a']);
  });
});

describe('FixtureOrchestrator.teardown', () => {
  it('tears down in reverse seed order', async () => {
    const order: string[] = [];
    const registry = registryOf({ id: 'a' }, { id: 'b' }, { id: 'c' });
    const orchestrator = new FixtureOrchestrator({
      registry,
      providers: [recordingProvider('sql', order)],
    });
    await orchestrator.seed({ testTags: ['@apps/checkout'], namespace: 'ns' });
    const report = await orchestrator.teardown();
    expect(order.slice(3)).toEqual(['teardown c', 'teardown b', 'teardown a']);
    expect(report.errors).toEqual([]);
  });

  it('never throws: a failing teardown is collected and the others still run', async () => {
    const order: string[] = [];
    const registry = registryOf({ id: 'a' }, { id: 'b' }, { id: 'c' });
    const orchestrator = new FixtureOrchestrator({
      registry,
      providers: [recordingProvider('sql', order, { failTeardownFor: 'b' })],
    });
    await orchestrator.seed({ testTags: ['@apps/checkout'], namespace: 'ns' });
    const report = await orchestrator.teardown();
    // c and a still torn down despite b throwing
    expect(order.slice(3)).toEqual(['teardown c', 'teardown b', 'teardown a']);
    expect(report.errors).toEqual([{ fixtureId: 'b', message: 'teardown boom for b' }]);
  });

  it('is idempotent — a second teardown has nothing left to do', async () => {
    const order: string[] = [];
    const registry = registryOf({ id: 'a' });
    const orchestrator = new FixtureOrchestrator({
      registry,
      providers: [recordingProvider('sql', order)],
    });
    await orchestrator.seed({ testTags: ['@apps/checkout'], namespace: 'ns' });
    await orchestrator.teardown();
    const second = await orchestrator.teardown();
    expect(second.errors).toEqual([]);
    expect(order.filter((o) => o.startsWith('teardown'))).toEqual(['teardown a']);
  });

  it('tears down whatever seeded before a mid-seed failure', async () => {
    const order: string[] = [];
    const registry = registryOf({ id: 'a', backend: 'sql' }, { id: 'b', backend: 'api' });
    const orchestrator = new FixtureOrchestrator({
      registry,
      providers: [recordingProvider('sql', order)], // no api provider → b fails
    });
    await expect(
      orchestrator.seed({ testTags: ['@apps/checkout'], namespace: 'ns' }),
    ).rejects.toMatchObject({ code: 'E_FIXTURE_NO_PROVIDER' });
    const report = await orchestrator.teardown();
    expect(order).toContain('teardown a');
    expect(report.errors).toEqual([]);
  });
});

describe('detectFixtureCycles', () => {
  it('throws E_FIXTURE_CYCLE when two fixtures reference each other', () => {
    const defs: FixtureDef[] = [
      {
        id: 'a',
        appliesTo: ['@x'],
        backend: 'sql',
        seed: 'uses {{bKey}}',
        teardown: '',
        provides: [{ entity: 'e', key: 'aKey', fields: {} }],
      },
      {
        id: 'b',
        appliesTo: ['@x'],
        backend: 'sql',
        seed: 'uses {{aKey}}',
        teardown: '',
        provides: [{ entity: 'e', key: 'bKey', fields: {} }],
      },
    ];
    expect(() => detectFixtureCycles(defs)).toThrowError(
      expect.objectContaining({ code: 'E_FIXTURE_CYCLE' }),
    );
  });

  it('accepts a DAG (one fixture references another, no cycle)', () => {
    const defs: FixtureDef[] = [
      {
        id: 'a',
        appliesTo: ['@x'],
        backend: 'sql',
        seed: 'no refs {{ns}}',
        teardown: '',
        provides: [{ entity: 'e', key: 'aKey', fields: {} }],
      },
      {
        id: 'b',
        appliesTo: ['@x'],
        backend: 'sql',
        seed: 'uses {{aKey}} and {{ns}}',
        teardown: '',
        provides: [],
      },
    ];
    expect(() => detectFixtureCycles(defs)).not.toThrow();
  });
});
