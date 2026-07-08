import { WardenError, type TestManagementSync, type WardenConfig } from '@warden/core';
import type { FetchLike } from '../fetch-like.js';
import { AllureTestOpsAdapter } from './allure-testops-adapter.js';
import { QaseAdapter } from './qase-adapter.js';
import { TestRailAdapter } from './testrail-adapter.js';
import { TestomatioAdapter } from './testomatio-adapter.js';
import { XrayAdapter } from './xray-adapter.js';
import { ZephyrAdapter } from './zephyr-adapter.js';

/** Collaborators `createTestManagementSync` may need, injected so tests never touch a real tool. */
export interface CreateTmsDeps {
  /** API token / bearer for the selected tool. Required unless `sync.source === 'none'`. */
  token?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
}

/**
 * Picks and constructs the `TestManagementSync` selected by `cfg.testManagement.sync.source`.
 * Returns `null` for `'none'` (the caller skips the sync step), mirroring `createIntegration`.
 * Throws a typed `WardenError` on a missing token / project / self-hosted url.
 */
export function createTestManagementSync(
  cfg: WardenConfig,
  deps: CreateTmsDeps = {},
): TestManagementSync | null {
  const { source, project, apiUrl } = cfg.testManagement.sync;

  if (source === 'none') return null;

  if (!deps.token) {
    throw new WardenError(
      `a token is required when testManagement.sync.source is "${source}"`,
      'TMS_MISSING_TOKEN',
    );
  }
  if (!project) {
    throw new WardenError(
      `testManagement.sync.project is required when source is "${source}"`,
      'TMS_MISSING_CONFIG',
    );
  }

  const token = deps.token;
  const fetchImpl = deps.fetchImpl;

  switch (source) {
    case 'testomatio':
      return new TestomatioAdapter({ token, project, apiUrl, fetchImpl });

    case 'qase':
      return new QaseAdapter({ token, project, apiUrl, fetchImpl });

    case 'xray':
      return new XrayAdapter({ token, project, apiUrl, fetchImpl });

    case 'zephyr':
      return new ZephyrAdapter({ token, project, apiUrl, fetchImpl });

    case 'testrail': {
      if (!apiUrl) {
        throw new WardenError(
          'testManagement.sync.apiUrl (self-hosted TestRail URL) is required when source is "testrail"',
          'TMS_MISSING_CONFIG',
        );
      }
      return new TestRailAdapter({ token, project, apiUrl, fetchImpl });
    }

    case 'allure-testops': {
      if (!apiUrl) {
        throw new WardenError(
          'testManagement.sync.apiUrl (self-hosted Allure TestOps URL) is required when source is "allure-testops"',
          'TMS_MISSING_CONFIG',
        );
      }
      return new AllureTestOpsAdapter({ token, project, apiUrl, fetchImpl });
    }

    default: {
      const exhaustiveCheck: never = source;
      throw new WardenError(
        `unknown test-management sync source: ${String(exhaustiveCheck)}`,
        'TMS_UNKNOWN_SOURCE',
      );
    }
  }
}
