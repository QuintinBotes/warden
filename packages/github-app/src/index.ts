/**
 * `@warden/github-app` — the org-installed GitHub App that runs cross-repo
 * coverage sync on `pull_request` events. This package owns only the GitHub /
 * octokit glue; all analysis lives in `@warden/coverage-sync`, `@warden/agent`,
 * and `@warden/orchestrator`.
 */
export { run, type PullRequestEvent, type RunDeps } from './app.js';
export {
  createOctokitFileAccess,
  splitRepo,
  errorStatus,
  type OctokitLike,
  type OctokitResponse,
} from './octokit-file-access.js';
export { createOctokitGitHubAccess } from './octokit-github-access.js';
export { createWebhookServer, type WebhookServerOptions } from './server.js';
