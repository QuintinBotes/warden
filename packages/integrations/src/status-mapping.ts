import type { CoverageStatus, Requirement } from '@warden/core';

/**
 * Maps a free-text workflow-state name (Linear/Jira state, GitHub issue state) onto
 * Warden's closed `CoverageStatus` enum. Shared across adapters so "Done" vs "done" vs
 * "Completed" all land on the same bucket regardless of which tracker they came from.
 */
export function mapStateNameToCoverageStatus(stateName: string): CoverageStatus {
  const normalized = stateName.trim().toLowerCase();

  if (['done', 'completed', 'closed', 'resolved'].includes(normalized)) {
    return 'PASSED';
  }
  if (["won't do", 'wont do', 'canceled', 'cancelled', 'rejected', 'failed'].includes(normalized)) {
    return 'FAILED';
  }
  if (['in progress', 'in review', 'blocked', 'started'].includes(normalized)) {
    return 'PARTIAL';
  }
  return 'NOT_TESTED';
}

/** Maps free-text labels (e.g. `["bug", "p1"]`) onto Warden's closed `Requirement.type`. */
export function mapLabelsToRequirementType(labels: string[]): Requirement['type'] {
  const normalized = labels.map((label) => label.trim().toLowerCase());

  if (normalized.some((label) => label.includes('bug'))) {
    return 'bug';
  }
  if (normalized.some((label) => label.includes('epic'))) {
    return 'epic';
  }
  if (normalized.some((label) => label.includes('feature'))) {
    return 'feature';
  }
  return 'story';
}
