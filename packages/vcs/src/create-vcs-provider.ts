import { WardenError, type VcsProvider, type WardenConfig } from '@warden/core';
import { AzureDevOpsVcsProvider } from './azure-devops-vcs-provider.js';
import { BitbucketVcsProvider } from './bitbucket-vcs-provider.js';
import { GitHubVcsProvider } from './github-vcs-provider.js';
import { GitLabVcsProvider } from './gitlab-vcs-provider.js';
import type { FetchImpl } from './vcs-http.js';

/** Collaborators `createVcsProvider` needs — a per-host token and an optional injected `fetch`. */
export interface CreateVcsProviderDeps {
  /** The host-specific token, resolved by the caller (CLI) from the CI-provided secret. */
  token: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchImpl;
}

/**
 * Selects and constructs the `VcsProvider` adapter for `cfg.vcs.provider`, threading through
 * `cfg.vcs.baseUrl` / `apiVersion`. Never reads env vars or secrets itself — the caller
 * resolves the token per host and passes it in.
 */
export function createVcsProvider(cfg: WardenConfig, deps: CreateVcsProviderDeps): VcsProvider {
  const { provider, baseUrl, apiVersion } = cfg.vcs;
  const common = { token: deps.token, baseUrl, fetchImpl: deps.fetchImpl };

  switch (provider) {
    case 'github':
      return new GitHubVcsProvider(common);
    case 'gitlab':
      return new GitLabVcsProvider(common);
    case 'bitbucket':
      return new BitbucketVcsProvider(common);
    case 'azure-devops':
      return new AzureDevOpsVcsProvider({ ...common, apiVersion });
    default: {
      const exhaustive: never = provider;
      throw new WardenError(`unknown vcs provider: ${String(exhaustive)}`, 'VCS_UNKNOWN_PROVIDER');
    }
  }
}
