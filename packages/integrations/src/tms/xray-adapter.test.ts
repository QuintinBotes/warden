import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like.js';
import { XrayAdapter } from './xray-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

function makeAdapter(fetchImpl: FetchLike) {
  return new XrayAdapter({ token: 'id:secret', project: 'CALC', fetchImpl });
}

const meta = { runRef: 'PR-1', environment: 'ci', startedAt: new Date('2026-07-07T00:00:00Z') };

describe('XrayAdapter', () => {
  it('authenticates then reads test issues via GraphQL into SpecCatalogEntry[]', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse('BEARER123'))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            getTests: {
              results: [
                {
                  jira: { key: 'CALC-1234', summary: 'Add two numbers', labels: ['smoke'] },
                  coverableIssues: { results: [{ jira: { key: 'REQ-1' } }] },
                },
              ],
            },
          },
        }),
      );
    const catalog = await makeAdapter(fetchImpl).pullCatalog();

    expect(catalog).toEqual([
      {
        externalId: 'CALC-1234',
        title: 'Add two numbers',
        tags: ['smoke'],
        requirementIds: ['REQ-1'],
        automation: 'manual',
      },
    ]);

    const [authUrl, authInit] = fetchImpl.mock.calls[0]!;
    expect(authUrl).toBe('https://xray.cloud.getxray.app/api/v2/authenticate');
    expect(JSON.parse(authInit?.body as string)).toEqual({
      client_id: 'id',
      client_secret: 'secret',
    });

    const [gqlUrl, gqlInit] = fetchImpl.mock.calls[1]!;
    expect(gqlUrl).toBe('https://xray.cloud.getxray.app/api/v2/graphql');
    expect((gqlInit?.headers as Record<string, string>).Authorization).toBe('Bearer BEARER123');
  });

  it('creates a test via a createTest GraphQL mutation', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse('BEARER123'))
      .mockResolvedValueOnce(
        jsonResponse({ data: { createTest: { test: { jira: { key: 'CALC-9' } } } } }),
      );
    const ref = await makeAdapter(fetchImpl).upsertTest({
      title: 'New',
      tags: [],
      requirementIds: [],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(ref.externalId).toBe('CALC-9');
    const body = JSON.parse(fetchImpl.mock.calls[1]![1]?.body as string);
    expect(body.query).toContain('createTest');
  });

  it('pushes results as an execution import', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse('BEARER123'))
      .mockResolvedValueOnce(jsonResponse({ key: 'CALC-100' }));
    await makeAdapter(fetchImpl).pushResults(
      [{ externalId: 'CALC-1234', status: 'PASS', durationMs: 10 }],
      meta,
    );

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe('https://xray.cloud.getxray.app/api/v2/import/execution');
    const payload = JSON.parse(init?.body as string);
    expect(payload.tests).toEqual([{ testKey: 'CALC-1234', status: 'PASSED' }]);
    expect(payload.info.environments).toEqual(['ci']);
  });
});
