import type { ContractDriftAdvisory, ContractVerificationResult } from '@warden/core';

/**
 * Pure: correlates failed Pact provider-verification results against a PR's declared
 * `links.dependents` and the `api.pact.consumerRepoMap`, producing a labeled, cross-repo
 * "who will break" advisory for `@warden/coverage-sync`'s check-run summary.
 *
 * For each {@link ContractVerificationResult} with at least one failed check: looks up
 * `consumerRepoMap[result.consumer]`; when found, sets `dependentRepo` and marks
 * `confidence: 'high'` when that repo also appears in `dependents`, otherwise `'low'`
 * (declared-but-unmapped and mapped-but-undeclared cases are still reported, just with
 * lower confidence — the same "declared links + heuristics, clearly labeled" posture the
 * cross-repo proposal takes for dependent-repo suggestions). Results with no failed checks,
 * and an empty `results` list, produce no advisories.
 */
export function contractDriftImpact(
  results: ContractVerificationResult[],
  dependents: string[],
  consumerRepoMap: Record<string, string>,
): ContractDriftAdvisory[] {
  const advisories: ContractDriftAdvisory[] = [];

  for (const result of results) {
    const failedInteractions = result.checks
      .filter((check) => !check.success)
      .map((check) => check.interaction.description);

    if (failedInteractions.length === 0) continue;

    const dependentRepo = consumerRepoMap[result.consumer];
    const confidence: ContractDriftAdvisory['confidence'] =
      dependentRepo !== undefined && dependents.includes(dependentRepo) ? 'high' : 'low';

    advisories.push({
      consumer: result.consumer,
      dependentRepo,
      confidence,
      failedInteractions,
      detail: `${result.consumer}'s contract with ${result.provider} failed ${failedInteractions.length} interaction(s): ${failedInteractions.join(', ')}`,
    });
  }

  return advisories;
}
