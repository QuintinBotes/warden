import { existsSync } from 'node:fs';
import path from 'node:path';
import { BrowserError } from '@warden/core';

/**
 * Finding the Playwright CLI a project has actually installed.
 *
 * Warden used to run tiers with `spawn('npx', ['playwright', …])`. `npm exec` cannot prompt in CI
 * or in any other non-TTY invocation, so in a repo with no Playwright it downloaded the package
 * from the registry unasked and ran it against a directory with no Playwright config and no
 * Playwright specs. The zero-test JSON that came back became a CTRF report with no tests in it,
 * which the gate reads as "no tests ran" — a WARN, and a green job that verified nothing.
 *
 * So resolution never installs. Warden runs the Playwright the project installed, or it says it
 * could not find one and fails the run.
 */

/**
 * Points Warden at a Playwright CLI outside the project's `node_modules` — a global install, or a
 * container image that ships one. Set deliberately by the user; an unset variable is never
 * substituted with a download.
 */
export const PLAYWRIGHT_BIN_ENV = 'WARDEN_PLAYWRIGHT_BIN';

/**
 * The npm bin-shim names for the Playwright CLI. `@playwright/test` and `playwright` both install
 * `playwright`; `.cmd` is the shim npm writes on Windows.
 */
const BIN_NAMES = process.platform === 'win32' ? ['playwright.cmd', 'playwright'] : ['playwright'];

/**
 * The nearest `node_modules/.bin/playwright` at or above `cwd`, or `undefined` when there is none.
 * Walking up is what makes a monorepo work: pnpm/npm workspaces put the shim in the package's own
 * `node_modules/.bin` when the package depends on Playwright, and in the workspace root's when
 * only the root does.
 */
export function findPlaywrightCli(cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of BIN_NAMES) {
      const candidate = path.join(dir, 'node_modules', '.bin', name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined; // filesystem root: nothing left to walk to
    dir = parent;
  }
}

/**
 * The Playwright CLI to spawn for a run rooted at `cwd`, or a {@link BrowserError} naming what to
 * install. {@link PLAYWRIGHT_BIN_ENV} wins when set — and a value that points at nothing is an
 * error rather than a quiet fall back to the project's own copy, because the user asked for that
 * binary specifically and running a different one would be answering a question they did not ask.
 */
export function resolvePlaywrightCli(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[PLAYWRIGHT_BIN_ENV]?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new BrowserError(
        `${PLAYWRIGHT_BIN_ENV} is set to ${override}, which does not exist. ` +
          `Point it at a Playwright CLI, or unset it to use the one installed in ${cwd}.`,
      );
    }
    return override;
  }

  const found = findPlaywrightCli(cwd);
  if (found) return found;

  throw new BrowserError(
    `Playwright is not installed in ${cwd} (no node_modules/.bin/playwright here or in any parent). ` +
      `Warden runs the Playwright the project installed and never downloads one, because a fetched ` +
      `Playwright would run against a repo with no config and no specs and report a green run that ` +
      `tested nothing. Install it — "npm install -D @playwright/test" then "npx playwright install" ` +
      `for the browsers — or pass --cwd for the project that has it, or set ${PLAYWRIGHT_BIN_ENV} to ` +
      `a Playwright CLI you installed yourself.`,
  );
}
