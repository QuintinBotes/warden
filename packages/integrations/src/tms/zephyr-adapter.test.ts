import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchResponseLike } from '../fetch-like.js';
import { ZephyrAdapter } from './zephyr-adapter.js';

function jsonResponse(body: unknown, ok = true, status = 200): FetchResponseLike {
  return { ok, status, json: async () => body };
}

function makeAdapter(fetchImpl: FetchLike) {
  return new ZephyrAdapter({ token: 'ze_key', project: 'ZE', fetchImpl });
}

const meta = { runRef: 'PR-1', environment: 'ci', startedAt: new Date('2026-07-07T00:00:00Z') };

describe('ZephyrAdapter', () => {
  it('pulls /testcases into SpecCatalogEntry[] keyed by test-case key', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        values: [
          {
            key: 'ZE-5',
            name: 'Search returns results',
            priorityName: 'High',
            labels: ['smoke'],
            automated: true,
            issueLinks: ['JIRA-3'],
          },
        ],
      }),
    );
    const catalog = await makeAdapter(fetchImpl).pullCatalog();

    expect(catalog).toEqual([
      {
        externalId: 'ZE-5',
        title: 'Search returns results',
        tags: ['smoke'],
        requirementIds: ['JIRA-3'],
        automation: 'automated',
        priority: 'P1',
      },
    ]);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.zephyrscale.smartbear.com/v2/testcases?projectKey=ZE&maxResults=100',
    );
  });

  it('creates (POST) and updates (PUT) test cases', async () => {
    const create = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ key: 'ZE-9' }));
    const ref = await makeAdapter(create).upsertTest({
      title: 'New',
      tags: ['@smoke'],
      requirementIds: [],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(ref.externalId).toBe('ZE-9');
    expect(create.mock.calls[0]![1]?.method).toBe('POST');

    const update = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}));
    await makeAdapter(update).upsertTest({
      externalId: 'ZE-5',
      title: 'Renamed',
      tags: [],
      requirementIds: [],
      priority: 'P2',
      source: 'ai-generated',
    });
    expect(update.mock.calls[0]![0]).toBe(
      'https://api.zephyrscale.smartbear.com/v2/testcases/ZE-5',
    );
    expect(update.mock.calls[0]![1]?.method).toBe('PUT');
  });

  it('pushes results as executions under a new test cycle', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ key: 'ZE-C1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));
    await makeAdapter(fetchImpl).pushResults(
      [{ externalId: 'ZE-5', status: 'FAIL', durationMs: 300, errorMessage: 'nope' }],
      meta,
    );

    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.zephyrscale.smartbear.com/v2/testcycles');
    const [execUrl, execInit] = fetchImpl.mock.calls[1]!;
    expect(execUrl).toBe('https://api.zephyrscale.smartbear.com/v2/testexecutions');
    const payload = JSON.parse(execInit?.body as string);
    expect(payload).toMatchObject({
      testCaseKey: 'ZE-5',
      testCycleKey: 'ZE-C1',
      statusName: 'Fail',
      comment: 'nope',
    });
  });
});
