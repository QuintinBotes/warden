import type {
  ChangeSurface,
  CoverageRecommender,
  DiffFile,
  FileAccess,
  LLMProvider,
  PrRef,
  WardenConfig,
} from '@warden/core';
import { createCoverageRecommender, createProvider } from '@warden/agent';
import { computeChangeSurface as defaultComputeChangeSurface } from '@warden/orchestrator';
import { runCoverageSync, type CoverageSyncSummary } from '@warden/coverage-sync';
import { createOctokitFileAccess, type OctokitLike } from './octokit-file-access.js';
import { createOctokitGitHubAccess } from './octokit-github-access.js';

/**
 * The slice of a GitHub `pull_request` webhook payload the App reads. The real
 * `@octokit/webhooks` payload is a superset, so it is assignable to this shape.
 */
export interface PullRequestEvent {
  action: string;
  installation?: { id: number };
  repository: {
    name: string;
    full_name: string;
    owner: { login: string };
  };
  pull_request: {
    number: number;
    head: { sha: string; ref: string };
    base?: { ref: string };
  };
}

/** Fully-injectable dependencies for {@link run}, so the pipeline is hermetic in tests. */
export interface RunDeps {
  event: PullRequestEvent;
  /** Resolve the (installation-scoped) octokit for an installation id. */
  octokitFor: (installationId: number) => OctokitLike;
  /** Load the source repo's Warden config over its {@link FileAccess}. */
  loadConfig: (repo: string, fileAccess: FileAccess) => Promise<WardenConfig>;
  /** Fetch the PR diff as `DiffFile[]` (the real one hits `GET .../pulls/{n}/files`). */
  fetchDiff: (octokit: OctokitLike, pr: PrRef) => Promise<DiffFile[]>;
  provider?: LLMProvider;
  recommender?: CoverageRecommender;
  computeChangeSurface?: (diff: DiffFile[], cfg: WardenConfig) => ChangeSurface;
}

/** Pull-request actions that trigger a coverage-sync run. */
const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

/** An empty summary returned for events we intentionally ignore. */
function noopSummary(): CoverageSyncSummary {
  return {
    status: 'no-gaps',
    changeSurface: {
      changedFiles: [],
      changedModules: [],
      testTags: [],
      hasSharedChanges: false,
      affectedApiRoutes: [],
      affectedComponents: [],
      riskScore: 0,
      riskReasons: [],
    },
    gaps: [],
    recommendations: [],
    draftPrs: [],
    selfSuggested: 0,
    checkPosted: false,
  };
}

/**
 * Run cross-repo coverage sync for a `pull_request` webhook event.
 *
 * Derives the source repo + {@link PrRef} + installation from the event, fetches
 * the diff, loads the source config, wires the octokit-backed {@link FileAccess} /
 * {@link GitHubAccess} adapters, then hands everything to
 * `runCoverageSync` from `@warden/coverage-sync`. The App owns only this glue;
 * all analysis lives in the injected/defaulted collaborators.
 *
 * Non-`opened`/`synchronize`/`reopened` actions are a no-op.
 */
export async function run(deps: RunDeps): Promise<CoverageSyncSummary> {
  const { event } = deps;
  if (!HANDLED_ACTIONS.has(event.action)) return noopSummary();

  const sourceRepo = event.repository.full_name;
  const sourcePr: PrRef = {
    owner: event.repository.owner.login,
    repo: event.repository.name,
    number: event.pull_request.number,
    headSha: event.pull_request.head.sha,
    headRef: event.pull_request.head.ref,
  };
  const installationId = event.installation?.id ?? 0;
  const octokit = deps.octokitFor(installationId);

  const diff = await deps.fetchDiff(octokit, sourcePr);

  // The source repo is read at the PR head; external targets at their default tip.
  const refFor = (repo: string): string => (repo === sourceRepo ? sourcePr.headSha : 'HEAD');
  const fileAccessFor = (repo: string): FileAccess =>
    createOctokitFileAccess(octokit, repo, refFor(repo));

  const cfg = await deps.loadConfig(sourceRepo, fileAccessFor(sourceRepo));
  const gh = createOctokitGitHubAccess(octokit);
  const provider = deps.provider ?? createProvider(cfg.ai);
  const recommender = deps.recommender ?? createCoverageRecommender();
  const computeChangeSurface = deps.computeChangeSurface ?? defaultComputeChangeSurface;

  return runCoverageSync({
    sourcePr,
    sourceRepo,
    diff,
    cfg,
    fileAccessFor,
    gh,
    recommender,
    provider,
    computeChangeSurface,
  });
}
