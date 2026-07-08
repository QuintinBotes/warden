import type { ChangeSurface, DiffFile } from './change-surface';
import type { LLMProvider } from './llm';
import type { WardenConfig } from './config';

/**
 * Cross-repo coverage sync contracts. When a PR opens in one GitHub repo, Warden inspects
 * the linked test/doc/dependent repos and proposes tests and docs to add/update/remove.
 * These are the shared types; `@warden/coverage-sync` and `@warden/github-app` implement them.
 */

/** A repository target: either the string `'self'` (the PR's own repo) or `'owner/repo'`. */
export type RepoTarget = string;

export interface TestRepoLink {
  repo: RepoTarget;
  pathPrefix?: string;
  /** How a changed module is correlated to tests: by `@module` tags / requirement links, or by mirrored path. */
  mapping?: 'by-tag' | 'by-path';
}

export interface DocRepoLink {
  repo: RepoTarget; // may be 'self' when docs live in the code repo
  pathPrefix?: string;
}

export interface RepoLinks {
  testRepos: TestRepoLink[];
  docRepos: DocRepoLink[];
  /** Repos whose tests exercise THIS repo (cross-service impact). */
  dependents: string[];
}

export type RecommendationKind = 'test' | 'doc';
export type RecommendationAction = 'add' | 'update' | 'remove';

export interface Recommendation {
  kind: RecommendationKind;
  action: RecommendationAction;
  targetRepo: RepoTarget;
  path: string;
  reason: string;
  requirementIds?: string[];
  /** Full file contents for `add`. */
  content?: string;
  /** Unified diff for `update` / `remove`. */
  patch?: string;
}

export interface CoverageGap {
  kind: RecommendationKind;
  type: 'uncovered' | 'changed' | 'orphaned';
  subject: string; // e.g. a route, component, or public signature
  detail: string;
  relatedPath?: string;
}

/** Minimal, injectable read access to a repo's files (backed by the GitHub contents API or fs). */
export interface FileAccess {
  listFiles(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
}

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  headRef: string;
}

export interface DraftPrResult {
  url: string;
  number: number;
}

/** Minimal, injectable write access to GitHub for publishing suggestions. */
export interface GitHubAccess {
  openOrUpdateDraftPr(
    repo: RepoTarget,
    branch: string,
    files: { path: string; content: string | null }[], // null content = delete
    title: string,
    body: string,
  ): Promise<DraftPrResult>;
  addPrSuggestions(
    pr: PrRef,
    files: { path: string; content: string }[],
    summary: string,
  ): Promise<void>;
  postCheckRun(
    pr: PrRef,
    conclusion: 'success' | 'neutral' | 'failure',
    title: string,
    summary: string,
  ): Promise<void>;
}

/** The add/update/remove engine (implemented in `@warden/agent`). */
export interface CoverageRecommender {
  recommend(input: {
    changeSurface: ChangeSurface;
    diff: DiffFile[];
    gaps: CoverageGap[];
    provider: LLMProvider;
    cfg: WardenConfig;
  }): Promise<Recommendation[]>;
}
