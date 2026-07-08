import type {
  CandidateCUJ,
  CujProposer,
  GeneratedTest,
  JourneyCluster,
  LLMProvider,
} from '@warden/core';

/**
 * `AiCujProposer` — the only LLM step downstream of clustering, and it only *names* the journey;
 * grouping and ranking stay deterministic. Given a cluster and the specs synthesized for it, it
 * asks the provider for a short, human-facing journey name and links the specs into a
 * `CandidateCUJ` for the CUJ-modeling board to adopt/gate. It is fail-safe: if the provider
 * returns nothing usable, it falls back to a deterministic name derived from the route template.
 */
export class AiCujProposer implements CujProposer {
  async propose(
    cluster: JourneyCluster,
    tests: GeneratedTest[],
    provider: LLMProvider,
  ): Promise<CandidateCUJ> {
    const prompt = buildCujNamingPrompt(cluster);
    let name = '';
    try {
      const raw = await provider.generateText(prompt);
      name = normalizeName(raw);
    } catch {
      name = '';
    }
    if (name.length === 0) name = fallbackName(cluster);

    return {
      name,
      signature: cluster.signature,
      frequency: cluster.frequency,
      routeTemplate: cluster.routeTemplate,
      testPaths: tests.map((t) => t.path),
    };
  }
}

export function createCujProposer(): CujProposer {
  return new AiCujProposer();
}

const CUJ_NAMING_INSTRUCTIONS = [
  'You are Warden. Name the critical user journey below in 3-8 words, title case, no quotes,',
  'no trailing punctuation. Respond with ONLY the name on a single line.',
].join('\n');

/** Deterministic given the cluster, so the prompt is stable and unit-testable. */
export function buildCujNamingPrompt(cluster: JourneyCluster): string {
  const stepLines = cluster.representative.steps.map((s, i) => {
    const parts = [`${i + 1}. ${s.action}`];
    if (s.selector) parts.push(`selector=${s.selector}`);
    return parts.join(' ');
  });
  return [
    CUJ_NAMING_INSTRUCTIONS,
    '',
    `Route: ${cluster.routeTemplate ?? cluster.representative.url}`,
    `Observed ${cluster.frequency} times.`,
    'Steps:',
    ...(stepLines.length > 0 ? stepLines : ['(none)']),
  ].join('\n');
}

/** Trims fences/quotes/whitespace and collapses the model output to a single-line name. */
function normalizeName(raw: string): string {
  const firstLine = raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return firstLine.replace(/^["'`]+|["'`]+$/g, '').trim();
}

/** A readable name derived from the route template when the LLM gives nothing usable. */
function fallbackName(cluster: JourneyCluster): string {
  const route = cluster.routeTemplate ?? cluster.representative.url;
  const segments = route
    .split('/')
    .filter((s) => s.length > 0 && !s.startsWith(':'))
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  const label = segments.length > 0 ? segments.join(' ') : 'Home';
  return `${label} journey`;
}
