import { describe, expect, it } from 'vitest';
import { createFixtureCatalog, type FixtureRecord } from '@warden/core';
import { DEFAULT_CATALOG_SUMMARY_CAP, renderFixtureCatalog } from './catalog-reader';

const records: FixtureRecord[] = [
  {
    entity: 'customer',
    key: 'primaryCustomer',
    fields: { email: 'primary+ns@test.warden', tier: 'gold', verified: true },
  },
  { entity: 'order', key: 'openOrder', fields: { id: 'ORD-ns-1', status: 'pending', total: null } },
];

describe('renderFixtureCatalog', () => {
  it('includes the namespace, every key, entity, and example values', () => {
    const summary = renderFixtureCatalog(createFixtureCatalog('pr482', records));
    expect(summary).toContain('namespace pr482');
    expect(summary).toContain("catalog.get('<key>')");
    expect(summary).toContain('customer.primaryCustomer');
    expect(summary).toContain('email=primary+ns@test.warden');
    expect(summary).toContain('order.openOrder');
    expect(summary).toContain('status=pending');
    expect(summary).toContain('total=null');
  });

  it('stays within the documented size cap and notes truncation', () => {
    const many: FixtureRecord[] = Array.from({ length: 500 }, (_, i) => ({
      entity: 'customer',
      key: `customer${i}`,
      fields: { email: `c${i}+ns@test.warden`, note: 'x'.repeat(40) },
    }));
    const summary = renderFixtureCatalog(createFixtureCatalog('ns', many));
    expect(summary.length).toBeLessThanOrEqual(DEFAULT_CATALOG_SUMMARY_CAP);
    expect(summary).toContain('more record(s) omitted');
  });

  it('honours a custom cap', () => {
    const summary = renderFixtureCatalog(createFixtureCatalog('ns', records), { maxChars: 120 });
    expect(summary.length).toBeLessThanOrEqual(120);
  });
});
