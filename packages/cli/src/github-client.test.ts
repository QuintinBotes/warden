import { describe, expect, it, vi } from 'vitest';
import { WardenError } from '@warden/core';
import { createFetchOctokit } from './github-client';

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function errResponse(status: number, text: string) {
  return { ok: false, status, json: async () => ({}), text: async () => text };
}

describe('createFetchOctokit', () => {
  it('posts an issue comment to the correct REST endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ id: 1 }));
    const client = createFetchOctokit({
      token: 'gh-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.issues.createComment({
      owner: 'acme',
      repo: 'checkout',
      issue_number: 42,
      body: 'hello',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/checkout/issues/42/comments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ body: 'hello' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gh-token');
  });

  it('creates a check run at the correct REST endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ id: 2 }));
    const client = createFetchOctokit({
      token: 'gh-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.checks.create({
      owner: 'acme',
      repo: 'checkout',
      name: 'Warden QA Gate',
      head_sha: 'abc123',
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Gate', summary: 'All good' },
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/checkout/check-runs');
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: 'Warden QA Gate',
      head_sha: 'abc123',
      conclusion: 'success',
    });
  });

  it('respects a custom baseUrl (e.g. GitHub Enterprise)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({}));
    const client = createFetchOctokit({
      token: 't',
      baseUrl: 'https://ghe.example.com/api/v3',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.issues.createComment({ owner: 'a', repo: 'b', issue_number: 1, body: 'x' });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ghe.example.com/api/v3/repos/a/b/issues/1/comments');
  });

  it('throws a WardenError when the GitHub API responds with a non-2xx status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errResponse(403, 'Forbidden'));
    const client = createFetchOctokit({
      token: 't',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.issues.createComment({ owner: 'a', repo: 'b', issue_number: 1, body: 'x' }),
    ).rejects.toThrow(WardenError);
  });
});
