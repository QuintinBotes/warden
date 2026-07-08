import { describe, expect, it } from 'vitest';
import { defineConfig } from '@warden/core';
import { AzureDevOpsVcsProvider } from './azure-devops-vcs-provider.js';
import { BitbucketVcsProvider } from './bitbucket-vcs-provider.js';
import { createVcsProvider } from './create-vcs-provider.js';
import { GitHubVcsProvider } from './github-vcs-provider.js';
import { GitLabVcsProvider } from './gitlab-vcs-provider.js';
import { routerFetch } from './test-fetch.js';

describe('createVcsProvider', () => {
  it('constructs the GitHub adapter by default', () => {
    const provider = createVcsProvider(defineConfig(), { token: 't' });
    expect(provider).toBeInstanceOf(GitHubVcsProvider);
    expect(provider.host).toBe('github');
  });

  it('selects the adapter for each configured host', () => {
    const gitlab = createVcsProvider(defineConfig({ vcs: { provider: 'gitlab' } }), { token: 't' });
    const bitbucket = createVcsProvider(defineConfig({ vcs: { provider: 'bitbucket' } }), {
      token: 't',
    });
    const azure = createVcsProvider(defineConfig({ vcs: { provider: 'azure-devops' } }), {
      token: 't',
    });

    expect(gitlab).toBeInstanceOf(GitLabVcsProvider);
    expect(bitbucket).toBeInstanceOf(BitbucketVcsProvider);
    expect(azure).toBeInstanceOf(AzureDevOpsVcsProvider);
  });

  it('threads cfg.vcs.baseUrl through to the adapter', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = createVcsProvider(
      defineConfig({ vcs: { provider: 'github', baseUrl: 'https://ghe.example.com/api/v3' } }),
      { token: 't', fetchImpl },
    );

    await provider.postComment({ host: 'github', owner: 'a', repo: 'b' }, 1, 'x');

    expect(calls[0]!.url).toBe('https://ghe.example.com/api/v3/repos/a/b/issues/1/comments');
  });

  it('threads cfg.vcs.apiVersion through to the Azure DevOps adapter', async () => {
    const { fetchImpl, calls } = routerFetch(() => ({ body: {} }));
    const provider = createVcsProvider(
      defineConfig({ vcs: { provider: 'azure-devops', apiVersion: '6.0' } }),
      { token: 't', fetchImpl },
    );

    await provider.postComment(
      { host: 'azure-devops', owner: 'org', project: 'proj', repo: 'r' },
      1,
      'x',
    );

    expect(calls[0]!.url).toContain('api-version=6.0');
  });
});
