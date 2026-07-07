import {
  WardenError,
  type AgentInput,
  type AgentOutput,
  type AgentStrategy,
  type FailureContext,
  type HealerDiagnosis,
  type Tool,
} from '@warden/core';
import { HEALER_SYSTEM_PROMPT } from './prompts';
import { asRecord, normalizeSeverity } from './strategy-support';

/** Tool the model calls to classify a failed test as a regression vs. a maintenance issue. */
const CLASSIFY_FAILURE_TOOL: Tool = {
  name: 'classify_failure',
  description: 'Classify a failed test as a real regression or a test-maintenance issue.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['regression', 'maintenance'] },
      severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
      explanation: { type: 'string', description: 'Why the test failed.' },
      proposedFix: { type: 'string', description: 'Minimal fix for the test or the app.' },
    },
    required: ['kind', 'explanation'],
  },
};

/**
 * Healer strategy — "diagnose a failed test". Consumes a {@link FailureContext}, asks the
 * provider to classify the failure via the `classify_failure` tool, and returns a
 * {@link HealerDiagnosis} (regression vs. maintenance) plus a Markdown report.
 */
export class HealerStrategy implements AgentStrategy {
  readonly name = 'healer' as const;

  async run(input: AgentInput): Promise<AgentOutput> {
    const { provider, config, failure } = input;
    if (!failure) {
      throw new WardenError(
        'Healer strategy requires a FailureContext (input.failure).',
        'E_AGENT_INPUT',
      );
    }

    const prompt = buildPrompt(failure);
    const result = await provider.generateWithTools(prompt, [CLASSIFY_FAILURE_TOOL], {
      systemPrompt: HEALER_SYSTEM_PROMPT,
      model: config.ai.model,
    });

    const call = result.toolCalls.find((c) => c.name === 'classify_failure');
    const diagnosis = call ? toDiagnosis(call.input) : fallbackDiagnosis(failure, result.text);

    return {
      findings: [],
      diagnosis,
      markdownReport: renderReport(diagnosis),
    };
  }
}

function buildPrompt(failure: FailureContext): string {
  const lines = [
    'A Playwright test failed. Classify it via classify_failure.',
    '',
    '## Test code',
    failure.testCode,
    '',
    '## Error message',
    failure.errorMessage,
  ];
  if (failure.stackTrace) lines.push('', '## Stack trace', failure.stackTrace);
  if (failure.screenshotPath) lines.push('', `Screenshot: ${failure.screenshotPath}`);
  if (failure.tracePath) lines.push('', `Trace: ${failure.tracePath}`);
  return lines.join('\n');
}

function toDiagnosis(input: unknown): HealerDiagnosis {
  const record = asRecord(input);
  const kind = record.kind === 'regression' ? 'regression' : 'maintenance';
  const diagnosis: HealerDiagnosis = {
    kind,
    explanation:
      typeof record.explanation === 'string' && record.explanation.length > 0
        ? record.explanation
        : 'No explanation was provided by the model.',
  };
  if (record.severity !== undefined) {
    diagnosis.severity = normalizeSeverity(record.severity, 'MEDIUM');
  }
  if (typeof record.proposedFix === 'string' && record.proposedFix.length > 0) {
    diagnosis.proposedFix = record.proposedFix;
  }
  return diagnosis;
}

const MAINTENANCE_HINTS = /timeout|selector|locator|not found|not visible|strict mode|detached/i;

/** Heuristic fallback when the model returned no structured classification. */
function fallbackDiagnosis(failure: FailureContext, text: string | undefined): HealerDiagnosis {
  const kind: HealerDiagnosis['kind'] = MAINTENANCE_HINTS.test(failure.errorMessage)
    ? 'maintenance'
    : 'regression';
  return {
    kind,
    explanation:
      text && text.trim().length > 0
        ? text.trim()
        : `Classified heuristically as ${kind} from the error message.`,
  };
}

function renderReport(diagnosis: HealerDiagnosis): string {
  const lines = ['# Healer Diagnosis', '', `**Classification:** ${diagnosis.kind}`];
  if (diagnosis.severity) lines.push(`**Severity:** ${diagnosis.severity}`);
  lines.push('', '## Explanation', '', diagnosis.explanation);
  if (diagnosis.proposedFix) {
    lines.push('', '## Proposed fix', '', '```', diagnosis.proposedFix, '```');
  }
  lines.push('');
  return lines.join('\n');
}
