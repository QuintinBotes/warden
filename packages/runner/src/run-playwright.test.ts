import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserError } from '@warden/core';
import { runPlaywright } from './run-playwright';
import { PLAYWRIGHT_BIN_ENV } from './playwright-cli';

/**
 * These drive a real child process. The Playwright CLI is stood in for by an executable shell
 * script on disk that records its argv and prints a real Playwright JSON report — the thing under
 * test is *which binary Warden launches*, not what Playwright does once launched.
 */

let root: string;

/** Writes an executable stand-in CLI at `path` that records argv/cwd to `<path>.argv`. */
async function writeFakeCli(path: string, body: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\n${body}\n`, 'utf-8');
  await chmod(path, 0o755);
}

/** A stand-in for the project's own `node_modules/.bin/playwright`. */
async function installFakePlaywright(projectDir: string): Promise<string> {
  const binDir = join(projectDir, 'node_modules', '.bin');
  await mkdir(binDir, { recursive: true });
  const cli = join(binDir, 'playwright');
  const report = {
    config: { version: '1.62.1' },
    stats: { startTime: '2026-08-21T09:00:00.000Z', duration: 12 },
    suites: [
      {
        title: 'checkout.spec.ts',
        file: 'e2e/checkout.spec.ts',
        specs: [
          {
            title: 'completes a purchase',
            file: 'e2e/checkout.spec.ts',
            tests: [{ results: [{ status: 'passed', duration: 12 }] }],
          },
        ],
      },
    ],
  };
  await writeFakeCli(
    cli,
    `printf '%s\\n' "$@" > "${cli}.argv"\n` +
      `pwd > "${cli}.cwd"\n` +
      `cat <<'JSON'\n${JSON.stringify(report)}\nJSON`,
  );
  return cli;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'warden-playwright-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runPlaywright binary resolution', () => {
  it('tells a project with no Playwright so, instead of downloading one behind its back', async () => {
    const project = join(root, 'no-playwright');
    await mkdir(project, { recursive: true });

    // A stand-in `npx` first on PATH: if Warden shells out to npm exec at all, this fires and
    // leaves the marker. `npx` in a repo with no Playwright is exactly the install-from-registry
    // path this fix exists to remove, so "the marker is absent" is the assertion that matters.
    const fakePath = join(root, 'fake-path');
    await mkdir(fakePath, { recursive: true });
    const marker = join(root, 'npx-was-invoked');
    await writeFakeCli(join(fakePath, 'npx'), `touch "${marker}"\necho '{}'`);

    // The project sits under a temp root, so the walk up cannot reach the Warden checkout's own
    // node_modules and find a Playwright that this project never installed.
    await expect(runPlaywright({ cwd: project, env: { PATH: fakePath } })).rejects.toThrow(
      BrowserError,
    );
    await expect(runPlaywright({ cwd: project, env: { PATH: fakePath } })).rejects.toThrow(
      /Playwright is not installed/i,
    );
    expect(existsSync(marker)).toBe(false);
  });

  it('names the directory it looked in and how to install, not just that it failed', async () => {
    const project = join(root, 'no-playwright');
    await mkdir(project, { recursive: true });

    const err = await runPlaywright({ cwd: project }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(BrowserError);
    expect(err.message).toContain(project);
    expect(err.message).toContain('@playwright/test');
    expect(err.message).toContain(PLAYWRIGHT_BIN_ENV);
  });

  it('runs the Playwright the project installed, with the tier grep it was given', async () => {
    const project = join(root, 'has-playwright');
    await mkdir(project, { recursive: true });
    const cli = await installFakePlaywright(project);

    const report = await runPlaywright({ cwd: project, grep: '@smoke' });

    const argv = (await readFile(`${cli}.argv`, 'utf-8')).trim().split('\n');
    expect(argv).toEqual(['test', '--reporter=json', '--grep', '@smoke']);
    expect(report.results.tests).toHaveLength(1);
    expect(report.results.tests[0]?.name).toBe('completes a purchase');
    expect(report.results.summary.passed).toBe(1);
  });

  it('finds the workspace root install from a package directory inside it', async () => {
    const project = join(root, 'monorepo');
    const pkg = join(project, 'packages', 'checkout');
    await mkdir(pkg, { recursive: true });
    const cli = await installFakePlaywright(project);

    const report = await runPlaywright({ cwd: pkg });

    expect(existsSync(`${cli}.argv`)).toBe(true);
    expect(report.results.summary.tests).toBe(1);
  });

  it(`treats a ${PLAYWRIGHT_BIN_ENV} that points at nothing as an error, not a silent fallback`, async () => {
    const project = join(root, 'has-playwright');
    await mkdir(project, { recursive: true });
    const cli = await installFakePlaywright(project);
    const missing = join(root, 'nowhere', 'playwright');

    const err = await runPlaywright({
      cwd: project,
      env: { [PLAYWRIGHT_BIN_ENV]: missing },
    }).catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(BrowserError);
    expect(err.message).toContain(missing);
    // The project's own copy is right there; running it would answer a question nobody asked.
    expect(existsSync(`${cli}.argv`)).toBe(false);
  });

  it(`runs the CLI ${PLAYWRIGHT_BIN_ENV} points at when the project has none of its own`, async () => {
    const project = join(root, 'no-playwright');
    await mkdir(project, { recursive: true });
    const globalProject = join(root, 'global');
    await mkdir(globalProject, { recursive: true });
    const cli = await installFakePlaywright(globalProject);

    const report = await runPlaywright({ cwd: project, env: { [PLAYWRIGHT_BIN_ENV]: cli } });

    expect(report.results.summary.tests).toBe(1);
    // It ran in the project it was pointed at, not in the directory the binary lives in.
    expect((await readFile(`${cli}.cwd`, 'utf-8')).trim()).toContain('no-playwright');
  });
});
