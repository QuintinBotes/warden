import { describe, expect, it, vi } from 'vitest';
import { WardenError } from '@warden/core';
import type { FetchLike, FetchResponseLike } from './fetch-like.js';
import { JiraAdapter } from './jira-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

/** A recorded Jira Cloud `/rest/api/3/search` response fixture. */
const JIRA_SEARCH_FIXTURE = {
  issues: [
    {
      key: 'QA-101',
      fields: {
        summary: 'User can reset password via email link',
        issuetype: { name: 'Story' },
        status: { name: 'Done' },
      },
    },
    {
      key: 'QA-102',
      fields: {
        summary: 'Cart total miscalculates with multiple coupons',
        issuetype: { name: 'Bug' },
        status: { name: 'In Progress' },
      },
    },
  ],
};

describe('JiraAdapter', () => {
  it('has the jira name', () => {
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = new JiraAdapter({
      token: 'jira-token',
      baseUrl: 'https://warden.atlassian.net',
      fetchImpl,
    });
    expect(adapter.name).toBe('jira');
  });

  describe('fetchRequirements', () => {
    it('maps the Jira search fixture to Requirement[]', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(JIRA_SEARCH_FIXTURE));
      const adapter = new JiraAdapter({
        token: 'jira-token',
        baseUrl: 'https://warden.atlassian.net',
        fetchImpl,
      });

      const requirements = await adapter.fetchRequirements();

      expect(requirements).toEqual([
        {
          id: 'QA-101',
          title: 'User can reset password via email link',
          type: 'story',
          linkedTestIds: [],
          coverageStatus: 'PASSED',
        },
        {
          id: 'QA-102',
          title: 'Cart total miscalculates with multiple coupons',
          type: 'bug',
          linkedTestIds: [],
          coverageStatus: 'PARTIAL',
        },
      ]);
    });

    it('GETs the search endpoint with a bearer token', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(JIRA_SEARCH_FIXTURE));
      const adapter = new JiraAdapter({
        token: 'jira-token',
        baseUrl: 'https://warden.atlassian.net',
        fetchImpl,
      });

      await adapter.fetchRequirements();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toContain('https://warden.atlassian.net/rest/api/3/search');
      expect(init?.method ?? 'GET').toBe('GET');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jira-token');
    });

    it('throws a WardenError on a non-2xx HTTP response', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, false, 403));
      const adapter = new JiraAdapter({
        token: 'bad-token',
        baseUrl: 'https://warden.atlassian.net',
        fetchImpl,
      });

      await expect(adapter.fetchRequirements()).rejects.toThrow(WardenError);
    });
  });

  describe('pushResult', () => {
    it('POSTs a comment with the coverage status to the issue', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: 'comment-1' }));
      const adapter = new JiraAdapter({
        token: 'jira-token',
        baseUrl: 'https://warden.atlassian.net',
        fetchImpl,
      });

      await adapter.pushResult('QA-101', 'FAILED');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://warden.atlassian.net/rest/api/3/issue/QA-101/comment');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jira-token');
      const body = JSON.parse(init?.body as string);
      expect(body.body).toContain('FAILED');
    });

    it('throws a WardenError on a non-2xx HTTP response', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, false, 404));
      const adapter = new JiraAdapter({
        token: 'jira-token',
        baseUrl: 'https://warden.atlassian.net',
        fetchImpl,
      });

      await expect(adapter.pushResult('QA-999', 'PASSED')).rejects.toThrow(WardenError);
    });
  });
});
