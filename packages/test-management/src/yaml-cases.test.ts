import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WardenError } from '@warden/core';
import { loadYamlCases } from './yaml-cases.js';

describe('loadYamlCases', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'warden-yaml-cases-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses a .yaml file into a validated TestCase', async () => {
    writeFileSync(
      join(dir, 'login.yaml'),
      [
        'id: TC-001',
        'title: User can log in',
        'type: integration',
        'priority: P1',
        'tags: [auth]',
        'requirementIds: [REQ-001]',
        'automation:',
        '  framework: playwright',
        '  filePath: tests/login.spec.ts',
        'source: manual',
      ].join('\n'),
    );

    const cases = await loadYamlCases(dir);

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: 'TC-001',
      title: 'User can log in',
      type: 'integration',
      priority: 'P1',
      tags: ['auth'],
      requirementIds: ['REQ-001'],
      source: 'manual',
    });
  });

  it('parses both .yaml and .yml extensions and ignores other files', async () => {
    writeFileSync(
      join(dir, 'a.yaml'),
      'id: TC-A\ntitle: A\ntype: unit\npriority: P2\nautomation:\n  framework: vitest\nsource: manual\n',
    );
    writeFileSync(
      join(dir, 'b.yml'),
      'id: TC-B\ntitle: B\ntype: unit\npriority: P3\nautomation:\n  framework: vitest\nsource: manual\n',
    );
    writeFileSync(join(dir, 'notes.txt'), 'irrelevant');

    const cases = await loadYamlCases(dir);

    expect(cases.map((c) => c.id).sort()).toEqual(['TC-A', 'TC-B']);
  });

  it('throws a WardenError when a file fails schema validation', async () => {
    writeFileSync(join(dir, 'bad.yaml'), 'id: TC-BAD\ntitle: Missing required fields\n');

    await expect(loadYamlCases(dir)).rejects.toThrow(WardenError);
  });

  it('returns an empty array for a directory with no yaml files', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'irrelevant');

    const cases = await loadYamlCases(dir);

    expect(cases).toEqual([]);
  });
});
