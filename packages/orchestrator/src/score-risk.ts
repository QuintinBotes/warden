import type { DiffFile, RiskReason, WardenConfig } from '@warden/core';

/**
 * Risk scoring for a change surface. Pure and deterministic: given the same diff and
 * config it always returns the same score and reasons, so gate decisions are reproducible
 * in CI and in tests.
 */

/** The most any single diff can score, matching the 1–10 range of `ChangeSurface.riskScore`. */
const MAX_SCORE = 10;

/**
 * How much the raw number of changed files can contribute. A broad diff is inherently
 * riskier, but file count alone must never dominate the pattern-based signal, so it is
 * clamped to a small constant.
 */
const FILE_COUNT_CLAMP = 3;

interface RiskRule {
  /** Case-insensitive regex tested against each file path. */
  regex: RegExp;
  /** Human-readable explanation attached to every matching `RiskReason`. */
  reason: string;
  /** Points added to the score for each matching file. */
  score: number;
}

const RULES: RiskRule[] = [
  { regex: /auth|login|password|session/i, reason: 'authentication or session change', score: 3 },
  { regex: /payment|checkout|billing|stripe/i, reason: 'payment or billing flow change', score: 5 },
  { regex: /database|migration|schema/i, reason: 'database or schema change', score: 4 },
  { regex: /security|permission|role|rbac/i, reason: 'security or permissions change', score: 4 },
  { regex: /config|env|feature.flag/i, reason: 'configuration or feature-flag change', score: 2 },
];

/** Points added for each configured `scope.highRiskPatterns` entry that a path contains. */
const HIGH_RISK_PATTERN_SCORE = 3;

/**
 * Score the risk of a diff. Each rule/high-risk-pattern hit on a file path yields one
 * {@link RiskReason}; the final score is the sum of all reason scores plus a clamped
 * file-count contribution, itself clamped to {@link MAX_SCORE}.
 */
export function scoreRisk(
  files: DiffFile[],
  cfg: WardenConfig,
): { score: number; reasons: RiskReason[] } {
  const reasons: RiskReason[] = [];

  for (const file of files) {
    const path = file.path;

    for (const rule of RULES) {
      const match = path.match(rule.regex);
      if (match) {
        reasons.push({ pattern: match[0].toLowerCase(), reason: rule.reason, score: rule.score });
      }
    }

    for (const pattern of cfg.scope.highRiskPatterns) {
      if (path.toLowerCase().includes(pattern.toLowerCase())) {
        reasons.push({
          pattern,
          reason: `high-risk path pattern "${pattern}"`,
          score: HIGH_RISK_PATTERN_SCORE,
        });
      }
    }
  }

  const matchedScore = reasons.reduce((sum, reason) => sum + reason.score, 0);
  const fileCountContribution = Math.min(files.length, FILE_COUNT_CLAMP);
  const score = Math.min(MAX_SCORE, matchedScore + fileCountContribution);

  return { score, reasons };
}
