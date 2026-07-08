import {
  FlakeRootCause,
  type FlakeClassification,
  type FlakeClassifier,
  type FlakeClassifierInput,
  type LLMProvider,
  type Tool,
  type WardenConfig,
} from '@warden/core';
import { FLAKE_CLASSIFIER_SYSTEM_PROMPT } from './prompts';
import { asRecord } from './strategy-support';

/** Tool the model calls to tag a flaky test with its most likely root cause. */
const CLASSIFY_FLAKE_TOOL: Tool = {
  name: 'classify_flake',
  description: 'Classify the root cause of a test that failed then passed across retries.',
  inputSchema: {
    type: 'object',
    properties: {
      rootCause: { type: 'string', enum: ['timing', 'selector', 'data', 'network', 'unknown'] },
      confidence: { type: 'number', description: '0 to 1.' },
      explanation: { type: 'string', description: 'Why this category, citing the error/history.' },
    },
    required: ['rootCause', 'explanation'],
  },
};

/** Confidence given to a heuristic (non-LLM) classification. */
const FALLBACK_CONFIDENCE = 0.4;
/** Confidence ceiling when there is too little history to classify reliably. */
const LOW_HISTORY_CONFIDENCE_CAP = 0.3;

const TIMING_HINTS = /timeout|timed out|\bwait|slow|animation|transition|race/i;
const SELECTOR_HINTS = /selector|locator|strict mode|detached|not visible|not attached|no element/i;
const NETWORK_HINTS =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network|\bDNS\b|socket hang up/i;
const ASSERTION_HINTS =
  /expect|assert|received|to (be|equal|contain)|mismatch|not equal|toEqual|toBe/i;

/** Regex heuristic mirroring the healer's fallback: pick a category from the error text alone. */
export function heuristicRootCause(errorMessage: string): FlakeRootCause {
  if (TIMING_HINTS.test(errorMessage)) return 'timing';
  if (SELECTOR_HINTS.test(errorMessage)) return 'selector';
  if (NETWORK_HINTS.test(errorMessage)) return 'network';
  if (ASSERTION_HINTS.test(errorMessage)) return 'data';
  return 'unknown';
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return fallback;
}

function normalizeRootCause(value: unknown): FlakeRootCause {
  const parsed = FlakeRootCause.safeParse(value);
  return parsed.success ? parsed.data : 'unknown';
}

function toClassification(testCaseId: string, input: unknown): FlakeClassification {
  const record = asRecord(input);
  return {
    testCaseId,
    rootCause: normalizeRootCause(record.rootCause),
    confidence: clampConfidence(record.confidence, FALLBACK_CONFIDENCE),
    explanation:
      typeof record.explanation === 'string' && record.explanation.length > 0
        ? record.explanation
        : 'No explanation was provided by the model.',
    classifiedAt: new Date(),
  };
}

/** Heuristic classification used when the LLM is skipped/unavailable or returns nothing usable. */
function fallbackClassification(
  input: FlakeClassifierInput,
  lowHistory: boolean,
): FlakeClassification {
  const rootCause = heuristicRootCause(input.latestFailure.errorMessage);
  const confidence = lowHistory
    ? Math.min(LOW_HISTORY_CONFIDENCE_CAP, FALLBACK_CONFIDENCE)
    : FALLBACK_CONFIDENCE;
  return {
    testCaseId: input.testCaseId,
    rootCause,
    confidence,
    explanation: `Classified heuristically as ${rootCause} from the failure message${
      lowHistory ? ' (insufficient history for a confident classification)' : ''
    }.`,
    classifiedAt: new Date(),
  };
}

function buildPrompt(input: FlakeClassifierInput): string {
  const lines = [
    'Classify why this test is flaky via the classify_flake tool.',
    '',
    `## Test case\n${input.testCaseId}`,
    '',
    '## Recent history (oldest first)',
    input.recentResults.length > 0
      ? input.recentResults
          .map((r, i) => `${i + 1}. ${r.status} (retries: ${r.retries})`)
          .join('\n')
      : '(no prior history)',
    '',
    '## Most recent failing attempt',
    input.latestFailure.errorMessage,
  ];
  if (input.latestFailure.stackTrace) {
    lines.push('', '## Stack trace', input.latestFailure.stackTrace);
  }
  return lines.join('\n');
}

/**
 * Creates the flake root-cause classifier. It follows the healer's `generateWithTools` +
 * tool-call pattern, with the same graceful-degradation posture: if there is too little history
 * (below `cfg.flake.classifier.minHistoryForClassification`) it skips the LLM entirely and uses a
 * confidence-capped heuristic; if the provider fails or returns no tool call, it falls back to the
 * heuristic. Every flake is therefore always tagged with *something*.
 */
export function createFlakeClassifier(): FlakeClassifier {
  return {
    async classify(
      input: FlakeClassifierInput,
      provider: LLMProvider,
      cfg: WardenConfig,
    ): Promise<FlakeClassification> {
      const minHistory = cfg.flake.classifier.minHistoryForClassification;
      if (input.recentResults.length < minHistory) {
        return fallbackClassification(input, true);
      }

      try {
        const result = await provider.generateWithTools(buildPrompt(input), [CLASSIFY_FLAKE_TOOL], {
          systemPrompt: FLAKE_CLASSIFIER_SYSTEM_PROMPT,
          model: cfg.ai.model,
        });
        const call = result.toolCalls.find((c) => c.name === 'classify_flake');
        return call
          ? toClassification(input.testCaseId, call.input)
          : fallbackClassification(input, false);
      } catch {
        return fallbackClassification(input, false);
      }
    },
  };
}
