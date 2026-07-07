/**
 * Loads and normalizes the GitHub webhook event payload (the JSON at
 * `$GITHUB_EVENT_PATH`) into a small {@link PrContext}. The action only gates
 * pull requests; any other event yields `null` and the action no-ops.
 */
import { ConfigError } from '@warden/core';
import type { FsLike } from './types.js';

export interface PrContext {
  number: number;
  title: string;
  url: string;
  headSha: string;
  baseSha: string;
  author?: string;
  repo: { owner: string; repo: string };
}

interface RawPullRequest {
  number?: number;
  title?: string;
  html_url?: string;
  url?: string;
  head?: { sha?: string };
  base?: { sha?: string };
  user?: { login?: string };
}

interface RawEvent {
  pull_request?: RawPullRequest;
  repository?: { name?: string; owner?: { login?: string } };
}

/**
 * Read the event payload and extract PR context. Returns `null` when there is
 * no path or no `pull_request` (so callers can skip the gate cleanly).
 */
export function loadPrEvent(eventPath: string | undefined, fs: FsLike): PrContext | null {
  if (!eventPath) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(eventPath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `Warden: could not read the GitHub event payload at "${eventPath}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let event: RawEvent;
  try {
    event = JSON.parse(raw) as RawEvent;
  } catch {
    throw new ConfigError(`Warden: the GitHub event payload at "${eventPath}" is not valid JSON.`);
  }

  const pr = event.pull_request;
  if (!pr || typeof pr.number !== 'number') return null;

  return {
    number: pr.number,
    title: pr.title ?? '',
    url: pr.html_url ?? pr.url ?? '',
    headSha: pr.head?.sha ?? '',
    baseSha: pr.base?.sha ?? '',
    author: pr.user?.login,
    repo: {
      owner: event.repository?.owner?.login ?? '',
      repo: event.repository?.name ?? '',
    },
  };
}

/**
 * Resolve the `{ owner, repo }` for GitHub API calls: prefer the event's repo,
 * else fall back to the `GITHUB_REPOSITORY` env var (`owner/repo`).
 */
export function resolveRepo(
  pr: PrContext,
  env: NodeJS.ProcessEnv,
): { owner: string; repo: string } {
  if (pr.repo.owner && pr.repo.repo) return pr.repo;
  const full = env.GITHUB_REPOSITORY;
  if (full && full.includes('/')) {
    const [owner = '', repo = ''] = full.split('/');
    return { owner, repo };
  }
  return pr.repo;
}
