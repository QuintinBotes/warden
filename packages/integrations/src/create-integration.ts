import { WardenError, type IntegrationAdapter, type WardenConfig } from '@warden/core';
import type { FetchLike } from './fetch-like.js';
import { GithubProjectsAdapter } from './github-projects-adapter.js';
import { JiraAdapter } from './jira-adapter.js';
import { LinearAdapter } from './linear-adapter.js';

/** Collaborators `createIntegration` may need, injected so tests never touch a real tracker. */
export interface CreateIntegrationDeps {
  /** API token / key for the selected provider. Required unless `cfg.integrations.provider === 'none'`. */
  token?: string;
  /** Injected fetch — defaults to the global `fetch`. Tests always inject a fake. */
  fetchImpl?: FetchLike;
  /** Extra config the Linear adapter needs beyond `token`/`fetchImpl`. */
  linear?: { teamId?: string; apiUrl?: string };
  /** Extra config the Jira adapter needs beyond `token`/`fetchImpl`. */
  jira?: { baseUrl: string; jql?: string };
  /** Extra config the GitHub Projects adapter needs beyond `token`/`fetchImpl`. */
  githubProjects?: { owner: string; repo: string; apiUrl?: string };
}

/**
 * Picks and constructs the `IntegrationAdapter` selected by `cfg.integrations.provider`.
 * Returns `null` for `'none'` — the caller is expected to treat that as "no requirement
 * sync configured" rather than an error.
 */
export function createIntegration(
  cfg: WardenConfig,
  deps: CreateIntegrationDeps = {},
): IntegrationAdapter | null {
  const provider = cfg.integrations.provider;

  switch (provider) {
    case 'none':
      return null;

    case 'linear': {
      if (!deps.token) {
        throw new WardenError(
          'a token is required when cfg.integrations.provider is "linear"',
          'INTEGRATION_MISSING_TOKEN',
        );
      }
      return new LinearAdapter({
        token: deps.token,
        fetchImpl: deps.fetchImpl,
        teamId: deps.linear?.teamId,
        apiUrl: deps.linear?.apiUrl,
      });
    }

    case 'jira': {
      if (!deps.token) {
        throw new WardenError(
          'a token is required when cfg.integrations.provider is "jira"',
          'INTEGRATION_MISSING_TOKEN',
        );
      }
      if (!deps.jira?.baseUrl) {
        throw new WardenError(
          'deps.jira.baseUrl is required when cfg.integrations.provider is "jira"',
          'INTEGRATION_MISSING_CONFIG',
        );
      }
      return new JiraAdapter({
        token: deps.token,
        fetchImpl: deps.fetchImpl,
        baseUrl: deps.jira.baseUrl,
        jql: deps.jira.jql,
      });
    }

    case 'github-projects': {
      if (!deps.token) {
        throw new WardenError(
          'a token is required when cfg.integrations.provider is "github-projects"',
          'INTEGRATION_MISSING_TOKEN',
        );
      }
      if (!deps.githubProjects?.owner || !deps.githubProjects?.repo) {
        throw new WardenError(
          'deps.githubProjects.owner and .repo are required when cfg.integrations.provider is "github-projects"',
          'INTEGRATION_MISSING_CONFIG',
        );
      }
      return new GithubProjectsAdapter({
        token: deps.token,
        fetchImpl: deps.fetchImpl,
        owner: deps.githubProjects.owner,
        repo: deps.githubProjects.repo,
        apiUrl: deps.githubProjects.apiUrl,
      });
    }

    default: {
      const exhaustiveCheck: never = provider;
      throw new WardenError(
        `unknown integration provider: ${String(exhaustiveCheck)}`,
        'INTEGRATION_UNKNOWN_PROVIDER',
      );
    }
  }
}
