import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@warden/core';
import { createRegistry } from './registry.js';

function manifest(overrides: Partial<PluginManifest> & { name: string }): PluginManifest {
  return {
    version: '1.0.0',
    description: '',
    entry: './plugin.js',
    capabilities: [],
    tags: [],
    ...overrides,
  };
}

const slack = manifest({
  name: '@acme/slack',
  description: 'Slack notifications for gate decisions',
  capabilities: ['onGateDecision'],
  tags: ['notifications', 'slack'],
});
const jira = manifest({
  name: '@acme/jira',
  description: 'File bugs in Jira automatically',
  capabilities: ['onBugFound'],
  tags: ['tracking', 'jira'],
});

const names = (list: PluginManifest[]): string[] => list.map((m) => m.name);

describe('createRegistry', () => {
  const registry = createRegistry([slack, jira]);

  it('lists all manifests in insertion order', () => {
    expect(names(registry.list())).toEqual(['@acme/slack', '@acme/jira']);
  });

  it('returns a defensive copy from list()', () => {
    registry.list().pop();
    expect(registry.list()).toHaveLength(2);
  });

  it('gets a manifest by name, or null when absent', () => {
    expect(registry.get('@acme/jira')).toEqual(jira);
    expect(registry.get('@acme/nope')).toBeNull();
  });

  it('searches text case-insensitively over name', () => {
    expect(names(registry.search({ text: 'SLACK' }))).toEqual(['@acme/slack']);
  });

  it('searches text over description', () => {
    expect(names(registry.search({ text: 'bugs' }))).toEqual(['@acme/jira']);
  });

  it('searches text over tags', () => {
    expect(names(registry.search({ text: 'tracking' }))).toEqual(['@acme/jira']);
  });

  it('searches capability by exact match only', () => {
    expect(names(registry.search({ capability: 'onBugFound' }))).toEqual(['@acme/jira']);
    expect(registry.search({ capability: 'onBug' })).toEqual([]);
  });

  it('searches tag by exact match only', () => {
    expect(names(registry.search({ tag: 'slack' }))).toEqual(['@acme/slack']);
    expect(registry.search({ tag: 'slac' })).toEqual([]);
  });

  it('ANDs all provided fields together', () => {
    expect(
      names(registry.search({ text: 'acme', capability: 'onGateDecision', tag: 'slack' })),
    ).toEqual(['@acme/slack']);
    expect(registry.search({ text: 'acme', capability: 'onGateDecision', tag: 'jira' })).toEqual(
      [],
    );
  });

  it('matches everything for an empty query', () => {
    expect(names(registry.search({}))).toEqual(['@acme/slack', '@acme/jira']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(registry.search({ text: 'zzz-none' })).toEqual([]);
  });
});
