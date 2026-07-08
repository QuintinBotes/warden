import { describe, expect, it, vi } from 'vitest';
import { defineConfig, WardenError } from '@warden/core';
import type { WardenConfig } from '@warden/core';
import type { FetchLike } from '../fetch-like.js';
import { createTestManagementSync } from './create-tms.js';
import { TestomatioAdapter } from './testomatio-adapter.js';
import { QaseAdapter } from './qase-adapter.js';
import { TestRailAdapter } from './testrail-adapter.js';
import { XrayAdapter } from './xray-adapter.js';
import { ZephyrAdapter } from './zephyr-adapter.js';
import { AllureTestOpsAdapter } from './allure-testops-adapter.js';

type Sync = WardenConfig['testManagement']['sync'];

function cfgWithSync(sync: Partial<Sync>): WardenConfig {
  return defineConfig({ testManagement: { sync } });
}

describe('createTestManagementSync', () => {
  it('returns null when the source is "none"', () => {
    expect(createTestManagementSync(cfgWithSync({ source: 'none' }))).toBeNull();
  });

  it('builds a TestomatioAdapter for "testomatio"', () => {
    const adapter = createTestManagementSync(cfgWithSync({ source: 'testomatio', project: 'p' }), {
      token: 'tm_key',
      fetchImpl: vi.fn<FetchLike>(),
    });
    expect(adapter).toBeInstanceOf(TestomatioAdapter);
    expect(adapter?.source).toBe('testomatio');
    expect(adapter?.sourceCodeFirst).toBe(true);
  });

  it('builds a QaseAdapter for "qase"', () => {
    const adapter = createTestManagementSync(cfgWithSync({ source: 'qase', project: 'DEMO' }), {
      token: 'qase_key',
    });
    expect(adapter).toBeInstanceOf(QaseAdapter);
    expect(adapter?.sourceCodeFirst).toBe(false);
  });

  it('builds an XrayAdapter for "xray"', () => {
    const adapter = createTestManagementSync(cfgWithSync({ source: 'xray', project: 'CALC' }), {
      token: 'id:secret',
    });
    expect(adapter).toBeInstanceOf(XrayAdapter);
  });

  it('builds a ZephyrAdapter for "zephyr"', () => {
    const adapter = createTestManagementSync(cfgWithSync({ source: 'zephyr', project: 'ZE' }), {
      token: 'ze_key',
    });
    expect(adapter).toBeInstanceOf(ZephyrAdapter);
  });

  it('builds a TestRailAdapter for "testrail" when apiUrl is provided', () => {
    const adapter = createTestManagementSync(
      cfgWithSync({ source: 'testrail', project: '1', apiUrl: 'https://acme.testrail.io' }),
      { token: 'email:key' },
    );
    expect(adapter).toBeInstanceOf(TestRailAdapter);
  });

  it('builds an AllureTestOpsAdapter for "allure-testops" when apiUrl is provided', () => {
    const adapter = createTestManagementSync(
      cfgWithSync({ source: 'allure-testops', project: '2', apiUrl: 'https://allure.acme.io' }),
      { token: 'allure_key' },
    );
    expect(adapter).toBeInstanceOf(AllureTestOpsAdapter);
  });

  it('throws TMS_MISSING_TOKEN when a source is selected without a token', () => {
    expect(() =>
      createTestManagementSync(cfgWithSync({ source: 'qase', project: 'DEMO' })),
    ).toThrow(WardenError);
    try {
      createTestManagementSync(cfgWithSync({ source: 'qase', project: 'DEMO' }));
    } catch (err) {
      expect((err as WardenError).code).toBe('TMS_MISSING_TOKEN');
    }
  });

  it('throws TMS_MISSING_CONFIG when project is missing', () => {
    try {
      createTestManagementSync(cfgWithSync({ source: 'qase' }), { token: 'k' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as WardenError).code).toBe('TMS_MISSING_CONFIG');
    }
  });

  it('throws TMS_MISSING_CONFIG when a self-hosted source lacks apiUrl', () => {
    try {
      createTestManagementSync(cfgWithSync({ source: 'testrail', project: '1' }), {
        token: 'email:key',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as WardenError).code).toBe('TMS_MISSING_CONFIG');
    }
  });
});
