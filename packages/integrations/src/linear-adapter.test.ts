import { describe, expect, it, vi } from 'vitest';
import { WardenError } from '@warden/core';
import type { FetchLike, FetchResponseLike } from './fetch-like.js';
import { LinearAdapter } from './linear-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

/** A recorded Linear GraphQL `issues` query response fixture. */
const LINEAR_ISSUES_FIXTURE = {
  data: {
    issues: {
      nodes: [
        {
          id: 'abc-123',
          identifier: 'ENG-42',
          title: 'Checkout flow supports Apple Pay',
          state: { name: 'Done' },
          labels: { nodes: [{ name: 'feature' }] },
        },
        {
          id: 'abc-124',
          identifier: 'ENG-43',
          title: 'Login form rejects empty passwords',
          state: { name: 'Todo' },
          labels: { nodes: [{ name: 'bug' }] },
        },
      ],
    },
  },
};

describe('LinearAdapter', () => {
  it('has the linear name', () => {
    const fetchImpl = vi.fn<FetchLike>();
    const adapter = new LinearAdapter({ token: 'lin_api_x', fetchImpl });
    expect(adapter.name).toBe('linear');
  });

  describe('fetchRequirements', () => {
    it('maps the Linear GraphQL issues fixture to Requirement[]', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(LINEAR_ISSUES_FIXTURE));
      const adapter = new LinearAdapter({ token: 'lin_api_x', fetchImpl });

      const requirements = await adapter.fetchRequirements();

      expect(requirements).toEqual([
        {
          id: 'ENG-42',
          title: 'Checkout flow supports Apple Pay',
          type: 'feature',
          linkedTestIds: [],
          coverageStatus: 'PASSED',
        },
        {
          id: 'ENG-43',
          title: 'Login form rejects empty passwords',
          type: 'bug',
          linkedTestIds: [],
          coverageStatus: 'NOT_TESTED',
        },
      ]);
    });

    it('sends the query as an authenticated POST to the Linear GraphQL endpoint', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(LINEAR_ISSUES_FIXTURE));
      const adapter = new LinearAdapter({ token: 'lin_api_x', fetchImpl });

      await adapter.fetchRequirements();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://api.linear.app/graphql');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).Authorization).toBe('lin_api_x');
      const body = JSON.parse(init?.body as string);
      expect(body.query).toContain('issues');
    });

    it('scopes the query to teamId when provided', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(LINEAR_ISSUES_FIXTURE));
      const adapter = new LinearAdapter({ token: 'lin_api_x', fetchImpl, teamId: 'team-9' });

      await adapter.fetchRequirements();

      const [, init] = fetchImpl.mock.calls[0]!;
      const body = JSON.parse(init?.body as string);
      expect(body.variables).toEqual({ teamId: 'team-9' });
    });

    it('throws a WardenError when the GraphQL response contains errors', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValue(jsonResponse({ errors: [{ message: 'not authorized' }] }));
      const adapter = new LinearAdapter({ token: 'bad-token', fetchImpl });

      await expect(adapter.fetchRequirements()).rejects.toThrow(WardenError);
    });

    it('throws a WardenError on a non-2xx HTTP response', async () => {
      const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}, false, 401));
      const adapter = new LinearAdapter({ token: 'bad-token', fetchImpl });

      await expect(adapter.fetchRequirements()).rejects.toThrow(WardenError);
    });
  });

  describe('pushResult', () => {
    it('POSTs a commentCreate mutation carrying the coverage status', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValue(jsonResponse({ data: { commentCreate: { success: true } } }));
      const adapter = new LinearAdapter({ token: 'lin_api_x', fetchImpl });

      await adapter.pushResult('abc-123', 'PASSED');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://api.linear.app/graphql');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.query).toContain('commentCreate');
      expect(body.variables).toEqual({
        issueId: 'abc-123',
        body: expect.stringContaining('PASSED'),
      });
    });

    it('throws a WardenError when the mutation response contains errors', async () => {
      const fetchImpl = vi
        .fn<FetchLike>()
        .mockResolvedValue(jsonResponse({ errors: [{ message: 'issue not found' }] }));
      const adapter = new LinearAdapter({ token: 'lin_api_x', fetchImpl });

      await expect(adapter.pushResult('missing', 'FAILED')).rejects.toThrow(WardenError);
    });
  });
});
