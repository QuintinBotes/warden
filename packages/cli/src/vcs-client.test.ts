import { describe, expect, it } from 'vitest';
import { WardenError, defineConfig } from '@warden/core';
import {
  createVcsProviderFromEnv,
  resolveVcsHeadSha,
  resolveVcsRepoRef,
  type EnvLike,
} from './vcs-client';

describe('resolveVcsRepoRef', () => {
  it('resolves a GitHub repo from GITHUB_REPOSITORY', () => {
    const cfg = defineConfig();
    expect(resolveVcsRepoRef(cfg, { GITHUB_REPOSITORY: 'acme/checkout' })).toEqual({
      host: 'github',
      owner: 'acme',
      repo: 'checkout',
    });
  });

  it('resolves a GitLab repo from CI_PROJECT_PATH (nested group)', () => {
    const cfg = defineConfig({ vcs: { provider: 'gitlab' } });
    expect(resolveVcsRepoRef(cfg, { CI_PROJECT_PATH: 'group/sub/checkout' })).toEqual({
      host: 'gitlab',
      owner: 'group/sub',
      repo: 'checkout',
    });
  });

  it('resolves a Bitbucket repo from workspace + repo slug', () => {
    const cfg = defineConfig({ vcs: { provider: 'bitbucket' } });
    const env: EnvLike = { BITBUCKET_WORKSPACE: 'team', BITBUCKET_REPO_SLUG: 'checkout' };
    expect(resolveVcsRepoRef(cfg, env)).toEqual({
      host: 'bitbucket',
      owner: 'team',
      repo: 'checkout',
    });
  });

  it('resolves an Azure DevOps repo from collection uri + project + repo name', () => {
    const cfg = defineConfig({ vcs: { provider: 'azure-devops' } });
    const env: EnvLike = {
      SYSTEM_COLLECTIONURI: 'https://dev.azure.com/myorg/',
      SYSTEM_TEAMPROJECT: 'proj',
      BUILD_REPOSITORY_NAME: 'checkout',
    };
    expect(resolveVcsRepoRef(cfg, env)).toEqual({
      host: 'azure-devops',
      owner: 'myorg',
      project: 'proj',
      repo: 'checkout',
    });
  });

  it('prefers cfg.vcs.project over SYSTEM_TEAMPROJECT for Azure DevOps', () => {
    const cfg = defineConfig({ vcs: { provider: 'azure-devops', project: 'override' } });
    const env: EnvLike = {
      SYSTEM_COLLECTIONURI: 'https://dev.azure.com/myorg/',
      SYSTEM_TEAMPROJECT: 'proj',
      BUILD_REPOSITORY_NAME: 'checkout',
    };
    expect(resolveVcsRepoRef(cfg, env).project).toBe('override');
  });

  it('throws a WardenError when a required env var is missing', () => {
    const cfg = defineConfig({ vcs: { provider: 'bitbucket' } });
    expect(() => resolveVcsRepoRef(cfg, {})).toThrow(WardenError);
  });
});

describe('resolveVcsHeadSha', () => {
  it('reads the host-specific commit env var', () => {
    expect(
      resolveVcsHeadSha(defineConfig({ vcs: { provider: 'gitlab' } }), { CI_COMMIT_SHA: 'abc' }),
    ).toBe('abc');
    expect(resolveVcsHeadSha(defineConfig(), { GITHUB_SHA: 'gh' })).toBe('gh');
  });

  it('returns undefined when the commit env var is absent', () => {
    expect(resolveVcsHeadSha(defineConfig(), {})).toBeUndefined();
  });
});

describe('createVcsProviderFromEnv', () => {
  it('constructs the provider for the configured host using its token env var', () => {
    const cfg = defineConfig({ vcs: { provider: 'gitlab' } });
    const provider = createVcsProviderFromEnv(cfg, { GITLAB_TOKEN: 'glpat' });
    expect(provider.host).toBe('gitlab');
  });

  it('throws a WardenError when the host token env var is missing', () => {
    const cfg = defineConfig({ vcs: { provider: 'azure-devops' } });
    expect(() => createVcsProviderFromEnv(cfg, {})).toThrow(WardenError);
  });
});
