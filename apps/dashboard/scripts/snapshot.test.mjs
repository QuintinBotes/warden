import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteStore } from '@warden/test-management';

/**
 * The snapshot script as it is actually invoked — `node scripts/snapshot.mjs`, with
 * WARDEN_STORE for a real store and without it for the demo dataset. Driving the script
 * rather than a function inside it is the point: the two paths differ only in that
 * environment variable, and that difference is what is under test.
 *
 * Everything here already needs a build, since snapshot.mjs imports @warden/* from dist.
 */
const SCRIPT = fileURLToPath(new URL('./snapshot.mjs', import.meta.url));

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'warden-snapshot-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const passing = (over) => ({
  status: 'PASS',
  duration: 100,
  retries: 0,
  flakeFlag: false,
  artifacts: [],
  ...over,
});

/** A store holding one run of Vitest-shaped results: content-hash ids, a suite, no filePath. */
function vitestStore() {
  const dbPath = join(dir, 'run.sqlite');
  const store = new SqliteStore(dbPath);
  store.saveExecution({
    id: 'EXEC-c73d638b',
    testPlanId: 'ad-hoc',
    triggerType: 'push',
    triggerRef: 'v1@ecd991f',
    environment: 'local-macos',
    startedAt: new Date('2026-08-21T10:35:31.368Z'),
    completedAt: new Date('2026-08-21T10:38:01.368Z'),
    results: [
      passing({
        testCaseId: 'TC-958794d4',
        name: 'the tab a running command is in is_marked_while_the_command_runs',
        suite: 'app.background.dom.test.tsx',
      }),
      passing({
        testCaseId: 'TC-11111111',
        name: 'the tab a running command is in reports_the_verdict_the_block_reached',
        suite: 'app.background.dom.test.tsx',
      }),
      passing({
        testCaseId: 'TC-e127a12e',
        name: 'a command Tervin has seen start is_reported_as_running',
        filePath: 'ui/src/lib/blocks.test.ts',
      }),
      passing({
        testCaseId: 'TC-0f0f0f0f',
        name: 'a test whose runner reported no grouping at all',
      }),
    ],
  });
  store.close();
  return dbPath;
}

/** Runs the script and returns the snapshot it wrote. */
function snapshot(env) {
  const out = join(dir, 'data.json');
  const merged = { ...process.env, ...env, WARDEN_SNAPSHOT_OUT: out };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete merged[k];
  }
  const run = spawnSync(process.execPath, [SCRIPT], { env: merged, encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(readFileSync(out, 'utf8'));
}

const tagsOf = (data, id) => data.results.find((r) => r.id === id).tags;

describe('snapshot.mjs — tags on a real store', () => {
  it('never labels a real result "e2e", because nothing told it the run was one', () => {
    const data = snapshot({ WARDEN_STORE: vitestStore() });

    expect(data.results).toHaveLength(4);
    expect(data.results.flatMap((r) => r.tags)).not.toContain('e2e');
  });

  it('tags a result with the suite or the file the runner reported', () => {
    const data = snapshot({ WARDEN_STORE: vitestStore() });

    expect(tagsOf(data, 'TC-958794d4')).toEqual(['app.background.dom.test.tsx']);
    expect(tagsOf(data, 'TC-e127a12e')).toEqual(['ui/src/lib/blocks.test.ts']);
  });

  it('gives two tests from the same suite the same tag, so the tag can be filtered on', () => {
    const data = snapshot({ WARDEN_STORE: vitestStore() });

    expect(tagsOf(data, 'TC-11111111')).toEqual(tagsOf(data, 'TC-958794d4'));
  });

  it('emits no tag at all, rather than a placeholder, when there is no grouping to report', () => {
    const data = snapshot({ WARDEN_STORE: vitestStore() });

    // The id is a content hash. Slicing it apart used to produce "0f0f0f0f" as a module
    // name — a tag unique to one test, which filters nothing and reads as a real grouping.
    expect(tagsOf(data, 'TC-0f0f0f0f')).toEqual([]);
  });
});

describe('snapshot.mjs — tags on the demo dataset', () => {
  it('keeps the demo dataset labelled by module, whose ids really are module-shaped', () => {
    const data = snapshot({ WARDEN_STORE: undefined });

    const auth = data.results.find((r) => r.id.startsWith('TC-AUTH-'));
    expect(auth.tags).toContain('auth');
    expect(auth.tags).toContain('e2e');
  });
});
