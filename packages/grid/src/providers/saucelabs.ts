import { CloudGridProvider, type CloudProviderDeps, type CloudProviderSpec } from './cloud-base';

const DEFAULT_SAUCE_REGION = 'us-west-1';

/** Build the Sauce Labs endpoint spec for a region (from `cfg.grid.region`, default us-west-1). */
export function sauceSpec(region: string = DEFAULT_SAUCE_REGION): CloudProviderSpec {
  const api = `https://api.${region}.saucelabs.com/rest/v1`;
  return {
    name: 'saucelabs',
    usernameEnv: 'SAUCE_USERNAME',
    accessKeyEnv: 'SAUCE_ACCESS_KEY',
    catalogUrl: `${api}/info/platforms/all`,
    sessionUrl: `${api}/sessions`,
    hubUrl: `https://ondemand.${region}.saucelabs.com/wd/hub`,
  };
}

/**
 * Sauce Labs grid adapter — the shared cloud seam over Sauce's REST + Appium/WebDriver endpoints.
 * Region-aware: the endpoints are built from `cfg.grid.region` (default `us-west-1`). Credentials
 * come from `SAUCE_USERNAME` / `SAUCE_ACCESS_KEY` in the injected env.
 */
export class SauceLabsProvider extends CloudGridProvider {
  constructor(deps: CloudProviderDeps) {
    super(sauceSpec(deps.config.region ?? DEFAULT_SAUCE_REGION), deps);
  }
}
