import type {
  HealConfidence,
  LLMProvider,
  LocatorRef,
  LocatorResolution,
  ProactiveHealSuggestion,
  Tool,
} from '@warden/core';
import type { LocatingSession } from './locator-resolver.js';
import { buildLocatorPatch } from './patch-utils.js';

/**
 * System prompt for locator repair. Mirrors the reasoning healer's convention: the model
 * inspects the live page's accessible tree and names the single closest replacement — it does
 * not rewrite the test, and it does not guess when nothing matches.
 */
export const PROACTIVE_HEAL_SYSTEM_PROMPT = `You repair a role/label locator that no longer resolves against a new build of a web app.
You are given ONE broken locator (its role and accessible name) and the accessible content of the live page.
Call propose_locator with the accessible name on the live page that most likely replaces the broken one.
Only propose a name that actually appears on the page. If nothing is a plausible match, do not call the tool.`;

/** Tool the model calls to name the closest replacement locator on the live page. */
const PROPOSE_LOCATOR_TOOL: Tool = {
  name: 'propose_locator',
  description: "Propose the closest replacement accessible name from the live page's roles/labels.",
  inputSchema: {
    type: 'object',
    properties: {
      suggestedName: {
        type: 'string',
        description: 'The accessible name / label text to use instead.',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      reason: { type: 'string', description: 'Why this is the closest match.' },
    },
    required: ['suggestedName', 'confidence'],
  },
};

export interface SuggestRepairsOptions {
  /** Suggestions below this bar carry no patch and are left for the reactive healer. */
  minConfidence?: HealConfidence;
  model?: string;
}

const CONFIDENCE_RANK: Record<HealConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * For each non-`resolved` locator, reads the live page (its accessible roles/labels) and asks
 * the provider — via the `propose_locator` tool, the same `generateWithTools` shape the reactive
 * `HealerStrategy` uses — to name the closest replacement, then packages it as a
 * {@link ProactiveHealSuggestion} with a minimal unified-diff `patch`.
 *
 * A response with no tool call falls back to `confidence: 'low'` and an empty patch (it never
 * guesses a change without saying so). A suggestion below `minConfidence` is returned with an
 * empty patch and a stated reason, so it's counted as "left for the reactive healer" rather than
 * silently applied.
 */
export async function suggestRepairs(
  resolutions: LocatorResolution[],
  session: LocatingSession,
  provider: LLMProvider,
  opts: SuggestRepairsOptions = {},
): Promise<ProactiveHealSuggestion[]> {
  const minConfidence = opts.minConfidence ?? 'medium';
  const suggestions: ProactiveHealSuggestion[] = [];

  for (const resolution of resolutions) {
    if (resolution.status === 'resolved') continue;
    suggestions.push(await suggestOne(resolution, session, provider, minConfidence, opts.model));
  }
  return suggestions;
}

async function suggestOne(
  resolution: LocatorResolution,
  session: LocatingSession,
  provider: LLMProvider,
  minConfidence: HealConfidence,
  model: string | undefined,
): Promise<ProactiveHealSuggestion> {
  const { locator } = resolution;
  const page = await session.readPage();
  const prompt = buildPrompt(resolution, page);
  const result = await provider.generateWithTools(prompt, [PROPOSE_LOCATOR_TOOL], {
    systemPrompt: PROACTIVE_HEAL_SYSTEM_PROMPT,
    model,
  });

  const call = result.toolCalls.find((c) => c.name === 'propose_locator');
  if (!call) {
    return noProposal(
      locator,
      'The model returned no structured proposal; left for the reactive healer.',
    );
  }

  const input = asRecord(call.input);
  const suggestedName = typeof input.suggestedName === 'string' ? input.suggestedName.trim() : '';
  if (suggestedName.length === 0) {
    return noProposal(
      locator,
      'The model proposed no replacement name; left for the reactive healer.',
    );
  }

  const confidence = normalizeConfidence(input.confidence);
  const modelReason =
    typeof input.reason === 'string' && input.reason.length > 0 ? input.reason : undefined;

  if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[minConfidence]) {
    return {
      locator,
      suggestedName,
      confidence,
      patch: '',
      reason:
        modelReason ??
        `Confidence ${confidence} is below the ${minConfidence} bar; left for the reactive healer.`,
    };
  }

  return {
    locator,
    suggestedName,
    confidence,
    patch: buildLocatorPatch(locator, suggestedName),
    reason: modelReason ?? `Re-resolved ${describe(locator)} to "${suggestedName}".`,
  };
}

function noProposal(locator: LocatorRef, reason: string): ProactiveHealSuggestion {
  return { locator, suggestedName: locator.name, confidence: 'low', patch: '', reason };
}

function buildPrompt(
  resolution: LocatorResolution,
  page: { url: string; title: string; text: string },
): string {
  const { locator, status, matchCount } = resolution;
  return [
    'A role/label locator no longer resolves uniquely against the new build.',
    'Propose the closest replacement accessible name via propose_locator.',
    '',
    '## Broken locator',
    `kind: ${locator.kind}`,
    `role: ${locator.role}`,
    `name: ${locator.name}`,
    `status: ${status} (matched ${matchCount} element${matchCount === 1 ? '' : 's'})`,
    '',
    '## Live page',
    `url: ${page.url}`,
    `title: ${page.title}`,
    page.text,
  ].join('\n');
}

function describe(locator: LocatorRef): string {
  return locator.kind === 'fill' ? `label "${locator.name}"` : `${locator.role} "${locator.name}"`;
}

function normalizeConfidence(value: unknown): HealConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
