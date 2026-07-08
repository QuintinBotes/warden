import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '@warden/core';
import {
  lintFixtureNamespace,
  namespaceRecords,
  referencesNamespace,
  renderTemplate,
} from './template';

describe('renderTemplate', () => {
  it('substitutes every {{ns}} occurrence, tolerating whitespace', () => {
    expect(renderTemplate('a {{ns}} b {{ ns }} c', 'NS')).toBe('a NS b NS c');
  });

  it('leaves templates without the token untouched', () => {
    expect(renderTemplate('no token here', 'NS')).toBe('no token here');
  });
});

describe('referencesNamespace', () => {
  it('detects the token regardless of previous regex state', () => {
    expect(referencesNamespace('x {{ns}}')).toBe(true);
    expect(referencesNamespace('x {{ns}}')).toBe(true);
    expect(referencesNamespace('none')).toBe(false);
  });
});

describe('namespaceRecords', () => {
  it('substitutes {{ns}} in string field values only', () => {
    const out = namespaceRecords(
      [
        {
          entity: 'customer',
          key: 'primary',
          fields: { email: 'primary+{{ns}}@test.warden', age: 30, active: true, note: null },
        },
      ],
      'pr482',
    );
    expect(out[0]!.fields.email).toBe('primary+pr482@test.warden');
    expect(out[0]!.fields.age).toBe(30);
    expect(out[0]!.fields.active).toBe(true);
    expect(out[0]!.fields.note).toBeNull();
  });

  it('does not mutate the input records', () => {
    const input = [{ entity: 'c', key: 'k', fields: { email: '{{ns}}' } }];
    namespaceRecords(input, 'ns');
    expect(input[0]!.fields.email).toBe('{{ns}}');
  });
});

function def(overrides: Partial<FixtureDef> = {}): FixtureDef {
  return {
    id: 'f1',
    appliesTo: ['@apps/checkout'],
    backend: 'sql',
    seed: 'INSERT ...',
    teardown: 'DELETE ...',
    provides: [],
    ...overrides,
  };
}

describe('lintFixtureNamespace', () => {
  it('warns when an identity-like field is seeded without {{ns}}', () => {
    const warnings = lintFixtureNamespace(
      def({ provides: [{ entity: 'customer', key: 'c', fields: { email: 'a@b.com' } }] }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('c.email');
  });

  it('stays silent when the seed references {{ns}}', () => {
    const warnings = lintFixtureNamespace(
      def({
        seed: "INSERT INTO customer(email) VALUES('a+{{ns}}@b.com')",
        provides: [{ entity: 'customer', key: 'c', fields: { email: 'a@b.com' } }],
      }),
    );
    expect(warnings).toEqual([]);
  });

  it('stays silent for non-identity fields', () => {
    const warnings = lintFixtureNamespace(
      def({ provides: [{ entity: 'order', key: 'o', fields: { total: 100 } }] }),
    );
    expect(warnings).toEqual([]);
  });
});
