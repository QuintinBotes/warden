import { WardenError } from '@warden/core';
import type { OctokitChecksClient, OctokitIssuesClient } from '@warden/reporter';

/** Options for {@link createFetchOctokit}. */
export interface FetchOctokitOptions {
  /** A GitHub token (`GITHUB_TOKEN` in Actions, or a PAT). */
  token: string;
  /** Defaults to `https://api.github.com`; override for GitHub Enterprise. */
  baseUrl?: string;
  /** Injected in tests instead of the global `fetch`, so no real network call is ever made. */
  fetchImpl?: typeof fetch;
}

async function githubRequest(
  opts: FetchOctokitOptions,
  method: string,
  url: string,
  body: unknown,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new WardenError(
      `GitHub API request failed: ${method} ${url} -> ${res.status} ${text}`,
      'CLI_GITHUB_REQUEST_FAILED',
    );
  }

  return res.json();
}

/**
 * A minimal `octokit`-shaped GitHub REST client built on the global `fetch`, so `warden report`
 * can post PR comments and check runs without adding an `@octokit/rest` dependency. Only
 * `bin/warden.ts` ever constructs one for a real run; unit tests inject `fetchImpl` so no real
 * network call is ever made.
 */
export function createFetchOctokit(
  opts: FetchOctokitOptions,
): OctokitIssuesClient & OctokitChecksClient {
  const baseUrl = opts.baseUrl ?? 'https://api.github.com';

  return {
    issues: {
      async createComment(params) {
        const url = `${baseUrl}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`;
        return githubRequest(opts, 'POST', url, { body: params.body });
      },
    },
    checks: {
      async create(params) {
        const url = `${baseUrl}/repos/${params.owner}/${params.repo}/check-runs`;
        return githubRequest(opts, 'POST', url, {
          name: params.name,
          head_sha: params.head_sha,
          status: params.status,
          conclusion: params.conclusion,
          output: params.output,
        });
      },
    },
  };
}
