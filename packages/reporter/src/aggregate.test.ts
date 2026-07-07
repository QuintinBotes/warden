import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WardenError } from '@warden/core';
import { fixtureExecution } from '@warden/core/testing';
import { aggregate } from './aggregate.js';
import { executionToCtrf } from './ctrf.js';

describe('aggregate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-aggregate-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('merges two CTRF files in a directory into one report', async () => {
    const smoke = executionToCtrf(
      fixtureExecution({
        results: [
          { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        ],
      }),
    );
    const regression = executionToCtrf(
      fixtureExecution({
        results: [
          { testCaseId: 'TC-2', status: 'FAIL', duration: 20, retries: 0, flakeFlag: false },
        ],
      }),
    );

    await fs.writeFile(path.join(dir, 'smoke.json'), JSON.stringify(smoke), 'utf-8');
    await fs.writeFile(path.join(dir, 'regression.json'), JSON.stringify(regression), 'utf-8');

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(2);
    expect(merged.results.summary.passed).toBe(1);
    expect(merged.results.summary.failed).toBe(1);
    expect(merged.results.tests.map((t) => t.name).sort()).toEqual(['TC-1', 'TC-2']);
  });

  it('ignores non-json files in the directory', async () => {
    const smoke = executionToCtrf(fixtureExecution());
    await fs.writeFile(path.join(dir, 'smoke.json'), JSON.stringify(smoke), 'utf-8');
    await fs.writeFile(path.join(dir, 'README.md'), '# not a report', 'utf-8');

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(1);
  });

  it('returns an empty report when the directory has no CTRF files', async () => {
    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(0);
    expect(merged.results.tests).toEqual([]);
  });

  it('throws a WardenError when the directory does not exist', async () => {
    await expect(aggregate(path.join(dir, 'does-not-exist'))).rejects.toThrow(WardenError);
  });
});
