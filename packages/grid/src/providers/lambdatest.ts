import { CloudGridProvider, type CloudProviderDeps, type CloudProviderSpec } from './cloud-base';

/** LambdaTest endpoints + credential env vars. */
export const LAMBDATEST_SPEC: CloudProviderSpec = {
  name: 'lambdatest',
  usernameEnv: 'LT_USERNAME',
  accessKeyEnv: 'LT_ACCESS_KEY',
  catalogUrl: 'https://api.lambdatest.com/automation/api/v1/platforms',
  sessionUrl: 'https://api.lambdatest.com/automation/api/v1/sessions',
  hubUrl: 'https://hub.lambdatest.com/wd/hub',
};

/**
 * LambdaTest grid adapter — the shared cloud seam pointed at LambdaTest's endpoints. Credentials
 * come from `LT_USERNAME` / `LT_ACCESS_KEY` in the injected env; the HTTP client is injected so the
 * adapter is fully hermetic in tests.
 */
export class LambdaTestProvider extends CloudGridProvider {
  constructor(deps: CloudProviderDeps) {
    super(LAMBDATEST_SPEC, deps);
  }
}
