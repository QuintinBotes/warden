import { CloudGridProvider, type CloudProviderDeps, type CloudProviderSpec } from './cloud-base';

/** BrowserStack endpoints + credential env vars. */
export const BROWSERSTACK_SPEC: CloudProviderSpec = {
  name: 'browserstack',
  usernameEnv: 'BROWSERSTACK_USERNAME',
  accessKeyEnv: 'BROWSERSTACK_ACCESS_KEY',
  catalogUrl: 'https://api.browserstack.com/automate/browsers.json',
  sessionUrl: 'https://api.browserstack.com/automate/sessions',
  hubUrl: 'https://hub-cloud.browserstack.com/wd/hub',
};

/**
 * BrowserStack grid adapter — the shared cloud seam pointed at BrowserStack's catalog / session /
 * hub endpoints. Credentials come from `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY` in the
 * injected env; the HTTP client is injected so the adapter is fully hermetic in tests.
 */
export class BrowserStackProvider extends CloudGridProvider {
  constructor(deps: CloudProviderDeps) {
    super(BROWSERSTACK_SPEC, deps);
  }
}
