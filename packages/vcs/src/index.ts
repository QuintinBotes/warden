/**
 * `@warden/vcs` — multi-SCM support. One `VcsProvider` adapter per host (GitHub, GitLab,
 * Bitbucket, Azure DevOps), a host-selecting factory, and a bridge that adapts any
 * `VcsProvider` onto `@warden/coverage-sync`'s `GitHubAccess` seam so cross-repo sync runs
 * host-agnostically. Every adapter is built on an injected `fetch` — no real network in tests.
 */
export { GitHubVcsProvider, type GitHubVcsProviderOptions } from './github-vcs-provider.js';
export { GitLabVcsProvider, type GitLabVcsProviderOptions } from './gitlab-vcs-provider.js';
export {
  BitbucketVcsProvider,
  type BitbucketVcsProviderOptions,
} from './bitbucket-vcs-provider.js';
export {
  AzureDevOpsVcsProvider,
  type AzureDevOpsVcsProviderOptions,
} from './azure-devops-vcs-provider.js';
export { createVcsProvider, type CreateVcsProviderDeps } from './create-vcs-provider.js';
export {
  createGitHubAccessFromVcsProvider,
  type GitHubAccessBridgeOptions,
} from './github-access-bridge.js';
export type { FetchImpl } from './vcs-http.js';
