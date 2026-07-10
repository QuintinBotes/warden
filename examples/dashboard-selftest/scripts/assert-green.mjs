// Assert the @smoke run against the dashboard was green: at least one test ran and none failed.
// Used by the dashboard-selftest CI job (and runnable locally) to turn a broken dashboard render
// into a red build. `warden run` itself exits 0 regardless of the gate, so this is the gate check.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(HERE, '..');
const ctrfPath = process.argv[2] ?? join(EXAMPLE, 'warden-artifacts', 'ctrf-report.json');

let summary;
try {
  summary = JSON.parse(readFileSync(ctrfPath, 'utf8')).results.summary;
} catch (err) {
  console.error(`❌ dashboard self-test: could not read CTRF report at ${ctrfPath} — ${err.message}`);
  process.exit(1);
}

const { tests, passed, failed } = summary;

if (tests < 1) {
  console.error(`❌ dashboard self-test: no tests ran — ${JSON.stringify(summary)}`);
  process.exit(1);
}
if (failed > 0) {
  console.error(`❌ dashboard self-test: ${failed} test(s) failed — ${JSON.stringify(summary)}`);
  process.exit(1);
}

console.log(`✅ dashboard self-test: ${passed}/${tests} passed, 0 failed`);
