// One-command self-test: run Warden's own smoke tier against the Warden dashboard (served
// over http), persist the run, and rebuild the dashboard snapshot FROM that run — so you can
// open the Sentinel dashboard locally and see your actual results.
//
// Prerequisites (see README): the monorepo is built (`pnpm -w build` at the repo root),
// and this example's deps + browser are installed (`pnpm install` here + `npx playwright install chromium`).
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(HERE, '..');
const REPO = resolve(EXAMPLE, '..', '..');
const STORE = join(EXAMPLE, 'warden.sqlite');
const CLI = join(REPO, 'packages', 'cli', 'dist', 'bin', 'warden.js');

function run(cmd, { cwd = EXAMPLE, env = {} } = {}) {
  console.log(`\n\x1b[2m$ ${cmd}\x1b[0m`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
}

console.log('▶  Warden dashboard self-test\n');

// 1. Build the dashboard export so Playwright has something to serve over http.
console.log('1/4  building the dashboard export (seed snapshot) …');
run('pnpm --filter dashboard snapshot', { cwd: REPO });
run('pnpm --filter dashboard build', { cwd: REPO });

// 2. Run the @smoke tier against the served dashboard, persisting the run into a store.
console.log('\n2/4  running the @smoke tier against the dashboard, persisting the run …');
run(`node "${CLI}" run --grep @smoke --db "${STORE}" --artifacts-dir warden-artifacts`);

// 3. Link one requirement per test to the run's real testCaseIds.
console.log('\n3/4  linking requirements to the run …');
run(`node scripts/seed-requirements.mjs "${STORE}"`);

// 4. Rebuild the dashboard snapshot FROM the real run.
console.log('\n4/4  rebuilding the dashboard from your run …');
run('pnpm --filter dashboard snapshot', { cwd: REPO, env: { WARDEN_STORE: STORE } });
run('pnpm --filter dashboard build', { cwd: REPO });

console.log('\n\x1b[32m✅  Done.\x1b[0m Your run is now in the dashboard. View it:');
console.log('     pnpm --filter dashboard dev        # http://localhost:3000');
console.log('   Artifacts: examples/dashboard-selftest/warden-artifacts/ (CTRF + job summary)');
console.log('   Playwright report: npx playwright show-report');
