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

  it('merges reports the tiers wrote into per-tier subdirectories', async () => {
    // The layout the scaffolded workflow produces: each tier writes to
    // `warden-artifacts/<tier>` and `actions/download-artifact` unpacks each artifact into
    // a directory of its own. Nothing lands at the top level.
    const smoke = executionToCtrf(
      fixtureExecution({
        results: [
          { testCaseId: 'TC-1', status: 'PASS', duration: 10, retries: 0, flakeFlag: false },
        ],
      }),
    );
    const selective = executionToCtrf(
      fixtureExecution({
        results: [
          { testCaseId: 'TC-2', status: 'FAIL', duration: 20, retries: 0, flakeFlag: false },
        ],
      }),
    );

    await fs.mkdir(path.join(dir, 'warden-ctrf-smoke'), { recursive: true });
    await fs.mkdir(path.join(dir, 'warden-ctrf-selective'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'warden-ctrf-smoke', 'ctrf-report.json'),
      JSON.stringify(smoke),
      'utf-8',
    );
    await fs.writeFile(
      path.join(dir, 'warden-ctrf-selective', 'ctrf-report.json'),
      JSON.stringify(selective),
      'utf-8',
    );

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(2);
    expect(merged.results.summary.failed).toBe(1);
    expect(merged.results.tests.map((t) => t.name).sort()).toEqual(['TC-1', 'TC-2']);
  });

  it('finds a report nested more than one level down', async () => {
    const nested = path.join(dir, 'warden-ctrf-selective', 'warden-artifacts', 'selective');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(nested, 'ctrf-report.json'),
      JSON.stringify(executionToCtrf(fixtureExecution())),
      'utf-8',
    );

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBeGreaterThan(0);
  });

  it('ignores non-json files in subdirectories too', async () => {
    await fs.mkdir(path.join(dir, 'warden-ctrf-smoke'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'warden-ctrf-smoke', 'ctrf-report.json'),
      JSON.stringify(executionToCtrf(fixtureExecution())),
      'utf-8',
    );
    await fs.writeFile(path.join(dir, 'warden-ctrf-smoke', 'trace.zip'), 'not a report', 'utf-8');
    await fs.mkdir(path.join(dir, 'warden-ctrf-smoke', 'screenshots'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'warden-ctrf-smoke', 'screenshots', 'shot.png'),
      'not a report',
      'utf-8',
    );

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(1);
  });

  it('ignores the agent report the scaffolded workflow writes beside the CTRF files', async () => {
    // `warden init` scaffolds `--output warden-artifacts/exploratory-report.json` and then
    // `--reports warden-artifacts`, so an AgentOutput always shares the aggregated directory.
    const smoke = executionToCtrf(fixtureExecution());
    await fs.writeFile(path.join(dir, 'smoke.json'), JSON.stringify(smoke), 'utf-8');
    await fs.writeFile(
      path.join(dir, 'exploratory-report.json'),
      JSON.stringify({
        findings: [{ id: 'F-1', severity: 'high', title: 'Pay button does nothing' }],
        markdownReport: '## Exploratory findings',
      }),
      'utf-8',
    );

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(1);
  });

  it('ignores the fixture catalog `warden run` writes into the artifacts directory', async () => {
    const smoke = executionToCtrf(fixtureExecution());
    await fs.writeFile(path.join(dir, 'smoke.json'), JSON.stringify(smoke), 'utf-8');
    await fs.writeFile(
      path.join(dir, 'fixture-catalog.json'),
      JSON.stringify({ namespace: 'wd-1', records: [] }),
      'utf-8',
    );

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(1);
  });

  it('ignores a directory whose name ends in .json', async () => {
    const smoke = executionToCtrf(fixtureExecution());
    await fs.writeFile(path.join(dir, 'smoke.json'), JSON.stringify(smoke), 'utf-8');
    await fs.mkdir(path.join(dir, 'traces.json'));

    const merged = await aggregate(dir);

    expect(merged.results.summary.tests).toBe(1);
  });

  it('names the file and the fields when a CTRF report is malformed, never a raw ZodError', async () => {
    // A file that claims to be CTRF but is not must still stop the run — skipping it would
    // understate the test count and let a broken report read as a confident green.
    await fs.writeFile(
      path.join(dir, 'broken.json'),
      JSON.stringify({ results: { tool: { name: 'playwright' }, tests: [] } }),
      'utf-8',
    );

    const err = await aggregate(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WardenError);
    const message = (err as WardenError).message;
    expect(message).toContain('broken.json');
    expect(message).toContain('results.summary');
    expect(message).not.toContain('ZodError');
  });
});
