import type {
  ChangeSurface,
  CoverageIndex,
  ImpactResult,
  ImpactedTest,
  WardenConfig,
} from '@warden/core';

/**
 * Intersect a change surface with a coverage index — the pure heart of Test Impact Analysis.
 *
 * For each changed file, every index entry whose `files` include it yields an impacted test
 * (reason names the file). Impacted tests are deduped by `testId` (first matching file wins the
 * reason). Changed files no entry covers land in `uncoveredChangedFiles`; `safetyNet` is set when
 * there are uncovered files AND the policy is not `warn` — the signal to escalate rather than
 * trust the narrowed set. Pure: no IO, deterministic order.
 */
export function computeImpact(
  changeSurface: ChangeSurface,
  index: CoverageIndex,
  cfg: WardenConfig,
): ImpactResult {
  const impactedByTest = new Map<string, ImpactedTest>();
  const coveredChangedFiles = new Set<string>();

  for (const changedFile of changeSurface.changedFiles) {
    for (const entry of index) {
      if (!entry.files.includes(changedFile)) continue;
      coveredChangedFiles.add(changedFile);
      if (!impactedByTest.has(entry.testId)) {
        impactedByTest.set(entry.testId, {
          testId: entry.testId,
          testName: entry.testName,
          reason: `Covers changed file ${changedFile}`,
        });
      }
    }
  }

  const uncoveredChangedFiles = changeSurface.changedFiles.filter(
    (f) => !coveredChangedFiles.has(f),
  );
  const safetyNet = uncoveredChangedFiles.length > 0 && cfg.impact.onUncovered !== 'warn';

  return {
    impacted: [...impactedByTest.values()],
    uncoveredChangedFiles,
    safetyNet,
  };
}
