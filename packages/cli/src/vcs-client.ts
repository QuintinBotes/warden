import {
  WardenError,
  type VcsHost,
  type VcsProvider,
  type VcsRepoRef,
  type WardenConfig,
} from '@warden/core';
import { createVcsProvider } from '@warden/vcs';

/** A read-only view of the process environment (injected in tests instead of `process.env`). */
export type EnvLike = Record<string, string | undefined>;

/** The CI-provided secret env var carrying the token for each host. */
const TOKEN_ENV: Record<VcsHost, string> = {
  github: 'GITHUB_TOKEN',
  gitlab: 'GITLAB_TOKEN',
  bitbucket: 'BITBUCKET_TOKEN',
  'azure-devops': 'AZURE_DEVOPS_TOKEN',
};

/** The CI-provided env var carrying the head commit SHA for each host. */
const HEAD_SHA_ENV: Record<VcsHost, string> = {
  github: 'GITHUB_SHA',
  gitlab: 'CI_COMMIT_SHA',
  bitbucket: 'BITBUCKET_COMMIT',
  'azure-devops': 'BUILD_SOURCEVERSION',
};

function required(env: EnvLike, name: string): string {
  const value = env[name];
  if (!value) {
    throw new WardenError(`${name} is required for vcs provider`, 'CLI_MISSING_VCS_ENV');
  }
  return value;
}

/** Parses the Azure DevOps organization from the collection URI env var. */
function azureOwner(env: EnvLike): string {
  const uri = env.SYSTEM_COLLECTIONURI ?? env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
  if (uri) {
    try {
      const url = new URL(uri);
      const seg = url.pathname.split('/').filter(Boolean);
      return seg[0] ?? url.hostname.split('.')[0]!;
    } catch {
      // fall through to the error below
    }
  }
  throw new WardenError(
    'SYSTEM_COLLECTIONURI is required to resolve the Azure DevOps organization',
    'CLI_MISSING_VCS_ENV',
  );
}

/**
 * Resolves the {@link VcsRepoRef} for the configured host from host-specific CI env vars —
 * `GITHUB_REPOSITORY` / `CI_PROJECT_PATH` / `BITBUCKET_WORKSPACE`+`BITBUCKET_REPO_SLUG` /
 * `SYSTEM_COLLECTIONURI`+`SYSTEM_TEAMPROJECT`+`BUILD_REPOSITORY_NAME`.
 */
export function resolveVcsRepoRef(cfg: WardenConfig, env: EnvLike): VcsRepoRef {
  const host = cfg.vcs.provider;
  switch (host) {
    case 'github': {
      const [owner, repo] = required(env, 'GITHUB_REPOSITORY').split('/');
      if (!owner || !repo) {
        throw new WardenError('GITHUB_REPOSITORY must be "owner/repo"', 'CLI_MISSING_VCS_ENV');
      }
      return { host, owner, repo };
    }
    case 'gitlab': {
      const path = env.CI_PROJECT_PATH;
      if (path) {
        const segments = path.split('/').filter(Boolean);
        const repo = segments.pop()!;
        const owner = segments.join('/') || required(env, 'CI_PROJECT_NAMESPACE');
        return { host, owner, repo };
      }
      return {
        host,
        owner: required(env, 'CI_PROJECT_NAMESPACE'),
        repo: required(env, 'CI_PROJECT_NAME'),
      };
    }
    case 'bitbucket':
      return {
        host,
        owner: required(env, 'BITBUCKET_WORKSPACE'),
        repo: required(env, 'BITBUCKET_REPO_SLUG'),
      };
    case 'azure-devops':
      return {
        host,
        owner: azureOwner(env),
        project: cfg.vcs.project ?? required(env, 'SYSTEM_TEAMPROJECT'),
        repo: required(env, 'BUILD_REPOSITORY_NAME'),
      };
    default: {
      const exhaustive: never = host;
      throw new WardenError(`unknown vcs provider: ${String(exhaustive)}`, 'CLI_UNKNOWN_VCS');
    }
  }
}

/** Resolves the head commit SHA from the configured host's CI env var, if present. */
export function resolveVcsHeadSha(cfg: WardenConfig, env: EnvLike): string | undefined {
  return env[HEAD_SHA_ENV[cfg.vcs.provider]];
}

/**
 * Constructs the configured {@link VcsProvider}, resolving the host-specific token from the
 * CI-provided secret env var (`GITHUB_TOKEN` / `GITLAB_TOKEN` / `BITBUCKET_TOKEN` /
 * `AZURE_DEVOPS_TOKEN`). Throws when the token is missing — never falls back to an unauthed call.
 */
export function createVcsProviderFromEnv(cfg: WardenConfig, env: EnvLike): VcsProvider {
  const tokenEnv = TOKEN_ENV[cfg.vcs.provider];
  const token = env[tokenEnv];
  if (!token) {
    throw new WardenError(
      `${tokenEnv} is required to authenticate the ${cfg.vcs.provider} vcs provider`,
      'CLI_MISSING_VCS_TOKEN',
    );
  }
  return createVcsProvider(cfg, { token });
}
