import { describe, expect, it } from 'vitest';
import { GridConfigSchema } from './grid';
import { defineConfig } from './config';

describe('GridConfigSchema', () => {
  it('fills every field from an empty object (existing configs stay valid)', () => {
    const grid = GridConfigSchema.parse(undefined);
    expect(grid).toEqual({
      enabled: false,
      provider: 'local',
      maxShards: 1,
      balanceBy: 'duration',
      matrix: { browsers: ['chromium'], devices: [] },
    });
  });

  it('accepts the cloud capability browsers on the matrix', () => {
    const grid = GridConfigSchema.parse({
      provider: 'browserstack',
      matrix: { browsers: ['webkit', 'safari', 'edge'], devices: ['iPhone 15'] },
      project: 'checkout-release',
    });
    expect(grid.matrix.browsers).toEqual(['webkit', 'safari', 'edge']);
    expect(grid.matrix.devices).toEqual(['iPhone 15']);
    expect(grid.project).toBe('checkout-release');
  });

  it('rejects a non-positive maxShards', () => {
    expect(GridConfigSchema.safeParse({ maxShards: 0 }).success).toBe(false);
  });
});

describe('WardenConfigSchema grid block', () => {
  it('defaults grid on a zero-config repo', () => {
    const cfg = defineConfig();
    expect(cfg.grid.enabled).toBe(false);
    expect(cfg.grid.provider).toBe('local');
    expect(cfg.grid.maxShards).toBe(1);
  });
});
