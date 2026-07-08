import { ConfigError, type GridConfig, type GridProvider } from '@warden/core';
import { defaultGridHttpClient, type GridHttpClient } from './http-client';
import { LocalGridProvider } from './providers/local';
import { BrowserStackProvider } from './providers/browserstack';
import { SauceLabsProvider } from './providers/saucelabs';
import { LambdaTestProvider } from './providers/lambdatest';
import { BROWSERSTACK_SPEC } from './providers/browserstack';
import { sauceSpec } from './providers/saucelabs';
import { LAMBDATEST_SPEC } from './providers/lambdatest';

/** Injected collaborators for {@link createGridProvider}. */
export interface CreateGridProviderDeps {
  /** HTTP client for cloud adapters; defaults to a real `fetch`-backed client. */
  http?: GridHttpClient;
  /** Credential source for cloud adapters. Defaults to `process.env`. Never read from config. */
  env?: Record<string, string | undefined>;
  /** Bounded-backoff sleep for `openSession` capacity retries (injected in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Max `openSession` attempts before a capacity error. */
  openRetries?: number;
  /** Base backoff between capacity retries. */
  backoffMs?: number;
}

/** The env var pairs each cloud provider reads its credentials from. */
const CLOUD_ENV = {
  browserstack: [BROWSERSTACK_SPEC.usernameEnv, BROWSERSTACK_SPEC.accessKeyEnv],
  saucelabs: [sauceSpec().usernameEnv, sauceSpec().accessKeyEnv],
  lambdatest: [LAMBDATEST_SPEC.usernameEnv, LAMBDATEST_SPEC.accessKeyEnv],
} as const;

/**
 * Select and construct the {@link GridProvider} named by `config.provider`. The `local` provider
 * needs no credentials; every cloud provider reads its credentials from the injected env (default
 * `process.env`) and **throws {@link ConfigError} up front if either credential is missing** — so a
 * misconfigured cloud run fails fast, before any paid lane is provisioned.
 */
export function createGridProvider(
  config: GridConfig,
  deps: CreateGridProviderDeps = {},
): GridProvider {
  if (config.provider === 'local') {
    return new LocalGridProvider(config);
  }

  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const [userVar, keyVar] = CLOUD_ENV[config.provider];
  if (!env[userVar] || !env[keyVar]) {
    throw new ConfigError(
      `grid provider "${config.provider}" requires ${userVar} and ${keyVar} in the environment`,
    );
  }

  const cloudDeps = {
    http: deps.http ?? defaultGridHttpClient(),
    env,
    config,
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.openRetries !== undefined ? { openRetries: deps.openRetries } : {}),
    ...(deps.backoffMs !== undefined ? { backoffMs: deps.backoffMs } : {}),
  };

  switch (config.provider) {
    case 'browserstack':
      return new BrowserStackProvider(cloudDeps);
    case 'saucelabs':
      return new SauceLabsProvider(cloudDeps);
    case 'lambdatest':
      return new LambdaTestProvider(cloudDeps);
    default: {
      // Exhaustiveness guard — `config.provider` is a closed union.
      const never: never = config.provider;
      throw new ConfigError(`unknown grid provider: ${String(never)}`);
    }
  }
}
