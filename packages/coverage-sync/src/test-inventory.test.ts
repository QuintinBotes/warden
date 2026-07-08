import { describe, expect, it } from 'vitest';
import type { FileAccess } from '@warden/core';
import { readTestInventory } from './test-inventory.js';
import { memFileAccess } from './testing-fakes.js';

const VALID_CASE = [
  'id: TC-001',
  'title: Checkout pays',
  'type: integration',
  'priority: P1',
  'automation:',
  '  framework: playwright',
  'source: manual',
  'tags:',
  "  - '@checkout'",
  '',
].join('\n');

describe('readTestInventory', () => {
  it('parses valid YAML cases and indexes spec/test files under the prefix', async () => {
    const tree = {
      'tests/checkout.yaml': VALID_CASE,
      'tests/checkout.spec.ts': 'test code',
      'tests/legacy.test.tsx': 'test code',
      'tests/README.md': 'ignored',
      'other/elsewhere.yaml': VALID_CASE,
    };

    const inv = await readTestInventory(
      { repo: 'org/e2e', pathPrefix: 'tests/' },
      memFileAccess(tree),
    );

    expect(inv.cases.map((c) => c.id)).toEqual(['TC-001']);
    expect(inv.specFiles).toEqual(['tests/checkout.spec.ts', 'tests/legacy.test.tsx']);
  });

  it('skips YAML that is not a valid TestCase instead of throwing', async () => {
    const tree = {
      'tests/broken.yaml': 'foo: bar\nbaz: 1\n',
      'tests/good.yml': VALID_CASE,
    };

    const inv = await readTestInventory(
      { repo: 'org/e2e', pathPrefix: 'tests/' },
      memFileAccess(tree),
    );

    expect(inv.cases.map((c) => c.id)).toEqual(['TC-001']);
  });

  it('defaults to the whole repo when no pathPrefix is given', async () => {
    const inv = await readTestInventory(
      { repo: 'org/e2e' },
      memFileAccess({ 'a/b.yaml': VALID_CASE }),
    );

    expect(inv.cases).toHaveLength(1);
  });

  it('skips files whose contents cannot be read (null)', async () => {
    const fileAccess: FileAccess = {
      async listFiles() {
        return ['tests/gone.yaml'];
      },
      async readFile() {
        return null;
      },
    };

    const inv = await readTestInventory({ repo: 'org/e2e', pathPrefix: 'tests/' }, fileAccess);

    expect(inv.cases).toEqual([]);
  });
});
