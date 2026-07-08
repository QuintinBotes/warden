import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '@warden/core';
import { SqlDataProvider, type SqlExecutor } from './sql';

function fakeSqlExecutor(): SqlExecutor & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async execute(sql: string) {
      statements.push(sql);
    },
  };
}

const def: FixtureDef = {
  id: 'checkout',
  appliesTo: ['@apps/checkout'],
  backend: 'sql',
  seed: "INSERT INTO customer(email) VALUES('primary+{{ns}}@test.warden')",
  teardown: "DELETE FROM customer WHERE email = 'primary+{{ns}}@test.warden'",
  provides: [
    { entity: 'customer', key: 'primaryCustomer', fields: { email: 'primary+{{ns}}@test.warden' } },
  ],
};

describe('SqlDataProvider', () => {
  it('supports only sql fixtures', () => {
    const provider = new SqlDataProvider(fakeSqlExecutor());
    expect(provider.supports(def)).toBe(true);
    expect(provider.supports({ ...def, backend: 'api' })).toBe(false);
    expect(provider.backend).toBe('sql');
  });

  it('renders {{ns}} into the seed script and returns namespaced records', async () => {
    const executor = fakeSqlExecutor();
    const provider = new SqlDataProvider(executor);
    const records = await provider.seed(def, 'pr482');
    expect(executor.statements[0]).toBe(
      "INSERT INTO customer(email) VALUES('primary+pr482@test.warden')",
    );
    expect(records[0]!.fields.email).toBe('primary+pr482@test.warden');
  });

  it('renders {{ns}} into the teardown script', async () => {
    const executor = fakeSqlExecutor();
    const provider = new SqlDataProvider(executor);
    await provider.teardown(def, 'pr482');
    expect(executor.statements[0]).toBe(
      "DELETE FROM customer WHERE email = 'primary+pr482@test.warden'",
    );
  });
});
