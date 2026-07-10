// Derive one Requirement per test in the latest run and link it to that test's real
// testCaseId, so the dashboard's "Requirement health" matrix lights up from the run.
//
// A real run derives testCaseId = contentId('TC', filePath::name) — a hash — so we read the
// ids straight off the saved execution rather than trying to author them by hand.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const { SqliteStore } = await import(
  join(REPO, 'packages', 'test-management', 'dist', 'index.js')
);

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: node seed-requirements.mjs <store.sqlite>');
  process.exit(1);
}

const store = new SqliteStore(dbPath);
const execs = store.listExecutions({});
const latest = execs[execs.length - 1];
if (!latest) throw new Error(`no executions in ${dbPath} — run \`warden run --db\` first`);

const clean = (name) => name.replace(/^@\w+\s+/, '').replace(/\s*\(.*\)\s*$/, '');
let n = 0;
for (const r of latest.results) {
  n += 1;
  store.saveRequirement({
    id: `REQ-DASH-${String(n).padStart(3, '0')}`,
    title: clean(r.name ?? r.testCaseId),
    type: 'story',
    linkedTestIds: [r.testCaseId],
    coverageStatus: r.status === 'PASS' ? 'PASSED' : r.status === 'FAIL' ? 'FAILED' : 'NOT_TESTED',
  });
}
console.log(`seeded ${n} requirements linked to the run's testCaseIds`);
store.close();
