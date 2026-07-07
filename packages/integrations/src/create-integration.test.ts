import { describe, expect, it, vi } from 'vitest';
import { defineConfig, WardenError } from '@warden/core';
import type { WardenConfig } from '@warden/core';
import type { FetchLike } from './fetch-like.js';
import { createIntegration } from './create-integration.js';
import { LinearAdapter } from './linear-adapter.js';
import { JiraAdapter } from './jira-adapter.js';
import { GithubProjectsAdapter } from './github-projects-adapter.js';

function cfgWithProvider(provider: WardenConfig['integrations']['provider']): WardenConfig {
  return defineConfig({ integrations: { provider } });
}

describe('createIntegration', () => {
  it('returns null when the provider is "none"', () => {
    const adapter = createIntegration(cfgWithProvider('none'));
    expect(adapter).toBeNull();
  });

  it('builds a LinearAdapter for the "linear" provider', () => {
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = createIntegration(cfgWithProvider('linear'), { token: 'lin_api_x', fetchImpl });
    expect(adapter).toBeInstanceOf(LinearAdapter);
    expect(adapter?.name).toBe('linear');
  });

  it('builds a JiraAdapter for the "jira" provider', () => {
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = createIntegration(cfgWithProvider('jira'), {
      token: 'jira-token',
      fetchImpl,
      jira: { baseUrl: 'https://warden.atlassian.net' },
    });
    expect(adapter).toBeInstanceOf(JiraAdapter);
    expect(adapter?.name).toBe('jira');
  });

  it('builds a GithubProjectsAdapter for the "github-projects" provider', () => {
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = createIntegration(cfgWithProvider('github-projects'), {
      token: 'gh-token',
      fetchImpl,
      githubProjects: { owner: 'warden-org', repo: 'warden' },
    });
    expect(adapter).toBeInstanceOf(GithubProjectsAdapter);
    expect(adapter?.name).toBe('github-projects');
  });

  it('throws a WardenError when "linear" is selected without a token', () => {
    expect(() => createIntegration(cfgWithProvider('linear'), {})).toThrow(WardenError);
  });

  it('throws a WardenError when "jira" is selected without a baseUrl', () => {
    expect(() => createIntegration(cfgWithProvider('jira'), { token: 'jira-token' })).toThrow(
      WardenError,
    );
  });

  it('throws a WardenError when "github-projects" is selected without owner/repo', () => {
    expect(() =>
      createIntegration(cfgWithProvider('github-projects'), { token: 'gh-token' }),
    ).toThrow(WardenError);
  });
});
