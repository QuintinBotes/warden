import type { ChangeSurface, CoverageGap, TestCase, WardenConfig } from '@warden/core';
import type { TestInventory } from './test-inventory.js';
import type { DocInventory } from './doc-inventory.js';

/**
 * Normalize a change-surface subject (a module, route, or component) or a test
 * tag into a comparable lowercase token: drop a leading `@` tag marker and any
 * leading slash, then lowercase.
 */
function token(subject: string): string {
  return subject.replace(/^@/, '').replace(/^\/+/, '').toLowerCase();
}

/** Whether a test case references `subject` by tag / requirement id (the `by-tag` mapping). */
function caseMatchesTag(testCase: TestCase, subject: string): boolean {
  const want = token(subject);
  if (!want) return false;
  const tags = testCase.tags.map(token);
  if (tags.some((tag) => tag === want || tag.includes(want))) return true;
  return testCase.requirementIds.some((id) => {
    const req = id.toLowerCase();
    return req === want || req.includes(want);
  });
}

/** Whether a file path references `subject` (the `by-path` mapping). */
function pathMatches(path: string, subject: string): boolean {
  const want = token(subject);
  if (!want) return false;
  return path.toLowerCase().includes(want);
}

/**
 * Classify cross-repo coverage & documentation gaps for a change.
 *
 * Emits {@link CoverageGap}s of both kinds (`test`, `doc`) and all three types:
 * - `uncovered` — a changed module/route/component with no matching test / doc.
 * - `changed` — a matching test / doc exists, so it likely asserts or describes
 *   the *old* behavior and may need updating.
 * - `orphaned` — a test / doc still referencing a subject removed by the change.
 *
 * The test/subject correlation honors the `mapping` declared on the config's
 * `testRepos` (`by-tag` vs `by-path`); when repos disagree, or leave it unset,
 * both correlations are allowed. `removedSubjects` are the subjects deleted by
 * the diff (derived by the caller); they drive the `orphaned` pass and are
 * excluded from the uncovered/changed passes.
 */
export function analyzeGaps(
  changeSurface: ChangeSurface,
  testInv: TestInventory,
  docInv: DocInventory,
  cfg: WardenConfig,
  removedSubjects: string[] = [],
): CoverageGap[] {
  const removed = new Set(removedSubjects.map(token));
  const isRemoved = (subject: string): boolean => removed.has(token(subject));

  const mappings = cfg.links.testRepos.map((repo) => repo.mapping ?? 'by-tag');
  const allowTag = mappings.length === 0 || mappings.includes('by-tag');
  const allowPath = mappings.includes('by-path');
  // If every declared repo opts into `by-path`, tag matching is off; otherwise tags stay on.
  const useTag = allowTag || !allowPath;

  const testCoveredBy = (subject: string): string | null => {
    if (useTag) {
      const hit = testInv.cases.find((testCase) => caseMatchesTag(testCase, subject));
      if (hit) return hit.automation.filePath ?? hit.id;
    }
    if (allowPath) {
      const spec = testInv.specFiles.find((path) => pathMatches(path, subject));
      if (spec) return spec;
      const spec2 = testInv.cases
        .map((testCase) => testCase.automation.filePath)
        .find((path): path is string => path != null && pathMatches(path, subject));
      if (spec2) return spec2;
    }
    return null;
  };

  const docCoveredBy = (subject: string): string | null =>
    docInv.docFiles.find((path) => pathMatches(path, subject)) ??
    docInv.openapiFiles.find((path) => pathMatches(path, subject)) ??
    null;

  const gaps: CoverageGap[] = [];

  // Subjects for tests: modules + routes + components. Subjects for docs: same set.
  const subjects = dedupe([
    ...changeSurface.changedModules,
    ...changeSurface.affectedApiRoutes,
    ...changeSurface.affectedComponents,
  ]);

  // 1 & 2: uncovered / changed, for the subjects still present in the change.
  for (const subject of subjects) {
    if (isRemoved(subject)) continue;

    const testHit = testCoveredBy(subject);
    if (testHit == null) {
      gaps.push({
        kind: 'test',
        type: 'uncovered',
        subject,
        detail: `Changed subject "${subject}" has no covering test.`,
      });
    } else {
      gaps.push({
        kind: 'test',
        type: 'changed',
        subject,
        detail: `Test "${testHit}" references changed subject "${subject}" and may assert old behavior.`,
        relatedPath: testHit,
      });
    }

    const docHit = docCoveredBy(subject);
    if (docHit == null) {
      gaps.push({
        kind: 'doc',
        type: 'uncovered',
        subject,
        detail: `Changed subject "${subject}" is not documented.`,
      });
    } else {
      gaps.push({
        kind: 'doc',
        type: 'changed',
        subject,
        detail: `Doc "${docHit}" describes changed subject "${subject}" and may be stale.`,
        relatedPath: docHit,
      });
    }
  }

  // 3: orphaned, for the subjects removed by the change that are still referenced.
  for (const subject of dedupe(removedSubjects)) {
    const testHit = testCoveredBy(subject);
    if (testHit != null) {
      gaps.push({
        kind: 'test',
        type: 'orphaned',
        subject,
        detail: `Test "${testHit}" still references removed subject "${subject}".`,
        relatedPath: testHit,
      });
    }
    const docHit = docCoveredBy(subject);
    if (docHit != null) {
      gaps.push({
        kind: 'doc',
        type: 'orphaned',
        subject,
        detail: `Doc "${docHit}" still documents removed subject "${subject}".`,
        relatedPath: docHit,
      });
    }
  }

  return gaps;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
