import { describe, expect, it, vi } from 'vitest';
import { WardenError } from '@warden/core';
import type { FetchLike, FetchResponseLike } from './fetch-like.js';
import { GithubProjectsAdapter } from './github-projects-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

/** A recorded `GET /repos/{owner}/{repo}/issues` response fixture. */
const GITHUB_ISSUES_FIXTURE = [
  {
    number: 17,
    title: 'Add SSO login',
    state: 'closed',
    state_reason: 'completed',
    labels: [{ name: 'type:feature' }],
  },
  {
    number: 21,
    title: 'Fix flaky checkout smoke test',
    state: 'open',
    state_reason: null,
    labels: [{ name: 'type:bug' }, { name: 'in-progress' }],
  },
];

describe('GithubProjectsAdapter', () => {
  it('has the github-projects name', () => {
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = new GithubProjectsAdapter({
      token: 'gh-token',
      owner: 'warden-org',
      repo: 'warden',
      fetchImpl,
    });
    expect(adapter.name).toBe('github-projects');
  });

  describe('fetchRequirements', () => {
    it('maps the GitHub issues fixture to Requirement[]', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(GITHUB_ISSUES_FIXTURE));
      const adapter = new GithubProjectsAdapter({
        token: 'gh-token',
        owner: 'warden-org',
        repo: 'warden',
        fetchImpl,
      });

      const requirements = await adapter.fetchRequirements();

      expect(requirements).toEqual([
        {
          id: '17',
          title: 'Add SSO login',
          type: 'feature',
          linkedTestIds: [],
          coverageStatus: 'PASSED',
        },
        {
          id: '21',
          title: 'Fix flaky checkout smoke test',
          type: 'bug',
          linkedTestIds: [],
          coverageStatus: 'PARTIAL',
        },
      ]);
    });

    it('GETs the repo issues endpoint with a token auth header', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(GITHUB_ISSUES_FIXTURE));
      const adapter = new GithubProjectsAdapter({
        token: 'gh-token',
        owner: 'warden-org',
        repo: 'warden',
        fetchImpl,
      });

      await adapter.fetchRequirements();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://api.github.com/repos/warden-org/warden/issues?state=all');
      expect(init?.method ?? 'GET').toBe('GET');
      expect((init?.headers as Record<string, string>).Authorization).toBe('token gh-token');
    });

    it('throws a WardenError on a non-2xx HTTP response', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, false, 404));
      const adapter = new GithubProjectsAdapter({
        token: 'gh-token',
        owner: 'warden-org',
        repo: 'missing-repo',
        fetchImpl,
      });

      await expect(adapter.fetchRequirements()).rejects.toThrow(WardenError);
    });
  });

  describe('pushResult', () => {
    it('PATCHes the issue with a coverage label', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ number: 17 }));
      const adapter = new GithubProjectsAdapter({
        token: 'gh-token',
        owner: 'warden-org',
        repo: 'warden',
        fetchImpl,
      });

      await adapter.pushResult('17', 'PASSED');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://api.github.com/repos/warden-org/warden/issues/17');
      expect(init?.method).toBe('PATCH');
      expect((init?.headers as Record<string, string>).Authorization).toBe('token gh-token');
      const body = JSON.parse(init?.body as string);
      expect(body.labels).toEqual(['warden-coverage:passed']);
    });

    it('throws a WardenError on a non-2xx HTTP response', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, false, 422));
      const adapter = new GithubProjectsAdapter({
        token: 'gh-token',
        owner: 'warden-org',
        repo: 'warden',
        fetchImpl,
      });

      await expect(adapter.pushResult('999', 'FAILED')).rejects.toThrow(WardenError);
    });
  });
});
