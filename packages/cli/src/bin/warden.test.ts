import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The `run` command is exercised as a real process, because the thing under test is the status the
 * shell (and therefore a CI step) sees — a value returned inside the module proves nothing about
 * it. Playwright is replaced by a shim binary named through `WARDEN_PLAYWRIGHT_BIN` that prints a
 * fixed JSON report and exits the way Playwright does: non-zero when a test failed, with the
 * report still on stdout. (The runner resolves an installed Playwright and never fetches one, so
 * that override — not a shim on PATH — is the seam a fake goes through.)
 *
 * Requires `pnpm -w build` to have run — CI builds before it tests, and a skipped assertion here
 * would be exactly the silent green this test exists to prevent.
 */

const CLI = fileURLToPath(new URL('../../dist/bin/warden.js', import.meta.url));

interface ShimSpec {
  title: string;
  status: 'passed' | 'failed';
}

function playwrightJson(specs: ShimSpec[]): string {
  return JSON.stringify({
    config: { version: '1.50.0' },
    stats: { startTime: '2026-08-21T00:00:00.000Z', duration: 1200 },
    suites: [
      {
        title: 'checkout.spec.ts',
        file: 'tests/checkout.spec.ts',
        specs: specs.map((spec) => ({
          title: spec.title,
          file: 'tests/checkout.spec.ts',
          tests: [
            {
              results: [
                {
                  status: spec.status,
                  duration: 50,
                  ...(spec.status === 'failed'
                    ? { error: { message: 'charged twice' } }
                    : undefined),
                },
              ],
            },
          ],
        })),
      },
    ],
  });
}

/** Writes a Playwright CLI that prints `json` and exits `exitCode`; returns the path to it. */
async function writeNpxShim(dir: string, json: string, exitCode: number): Promise<string> {
  const shimDir = path.join(dir, 'shim');
  await fs.mkdir(shimDir, { recursive: true });
  const shim = path.join(shimDir, 'playwright');
  await fs.writeFile(
    shim,
    `#!/bin/sh\ncat <<'WARDEN_SHIM_JSON'\n${json}\nWARDEN_SHIM_JSON\nexit ${exitCode}\n`,
    'utf-8',
  );
  await fs.chmod(shim, 0o755);
  return shim;
}

function runCli(
  cwd: string,
  playwrightBin: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: {
        ...process.env,
        WARDEN_PLAYWRIGHT_BIN: playwrightBin,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('warden run (as a process)', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(tmpdir(), 'warden-run-exit-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('has a built CLI to exercise', () => {
    expect(
      existsSync(CLI),
      `${CLI} is missing — run \`pnpm -w build\` before \`pnpm -w test\``,
    ).toBe(true);
  });

  it('exits non-zero and names the reason when the gate blocks on a failing test', async () => {
    const shimDir = await writeNpxShim(
      cwd,
      playwrightJson([
        { title: 'adds to cart', status: 'passed' },
        { title: 'completes payment', status: 'failed' },
      ]),
      // Playwright's own exit status for a red run. The runner deliberately discards it, so the
      // gate is the only thing that can carry the failure out to the shell.
      1,
    );

    const result = await runCli(cwd, shimDir, [
      'run',
      '--grep',
      '@smoke',
      '--artifacts-dir',
      './artifacts',
    ]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('gate: BLOCK');
    expect(result.stdout).toContain('1 test(s) failed');
  }, 60_000);

  it('still writes the CTRF report for the failing run it blocks on', async () => {
    const shimDir = await writeNpxShim(
      cwd,
      playwrightJson([{ title: 'completes payment', status: 'failed' }]),
      1,
    );

    const result = await runCli(cwd, shimDir, ['run', '--artifacts-dir', './artifacts']);

    expect(result.code).toBe(1);
    const ctrf = JSON.parse(
      await fs.readFile(path.join(cwd, 'artifacts', 'ctrf-report.json'), 'utf-8'),
    );
    expect(ctrf.results.summary.failed).toBe(1);
  }, 60_000);

  it('exits zero and reports the passing gate when every test passed', async () => {
    const shimDir = await writeNpxShim(
      cwd,
      playwrightJson([{ title: 'adds to cart', status: 'passed' }]),
      0,
    );

    const result = await runCli(cwd, shimDir, ['run', '--artifacts-dir', './artifacts']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('gate: PASS');
  }, 60_000);
});
