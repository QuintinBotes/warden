import { z } from 'zod';
import {
  ProviderError,
  type GeneratedTest,
  type LLMProvider,
  type RecordedSession,
  type TestSynthesizer,
} from '@warden/core';

/**
 * The contract we ask the LLM to return: the recorded session distilled into distinct user
 * flows. Each flow is a named, tagged sequence of role-oriented steps that the synthesizer then
 * renders deterministically into a Playwright spec. Keeping generation deterministic (the model
 * decides *what* the flows are; we decide *how* they are written) makes the output stable and
 * unit-testable.
 */
export const SynthStepSchema = z.object({
  kind: z.enum(['goto', 'click', 'fill', 'expectVisible', 'expectText']),
  url: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional(),
});
export type SynthStep = z.infer<typeof SynthStepSchema>;

export const SynthFlowSchema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  steps: z.array(SynthStepSchema).min(1),
});
export type SynthFlow = z.infer<typeof SynthFlowSchema>;

export const SynthResponseSchema = z.object({
  flows: z.array(SynthFlowSchema).default([]),
});

const SYNTHESIS_INSTRUCTIONS = [
  'You are Warden test synthesizer. Turn the recorded browser session below into distinct,',
  'non-overlapping end-to-end user flows expressed with role-based locators.',
  'Respond with ONLY JSON of shape:',
  '{ "flows": [ { "name": string, "tags": string[], "steps": [',
  '  { "kind": "goto", "url": string } |',
  '  { "kind": "click", "role": string, "name": string } |',
  '  { "kind": "fill", "label": string, "value": string } |',
  '  { "kind": "expectVisible" | "expectText", "text": string }',
  '] } ] }',
  'Do not emit two flows where one is a subset of another; merge or drop the smaller.',
].join('\n');

/** Renders the session into the synthesis prompt. Deterministic given the session. */
export function buildSynthesisPrompt(session: RecordedSession): string {
  const stepLines = session.steps.map((s, i) => {
    const parts = [`${i + 1}. ${s.action}`];
    if (s.selector) parts.push(`selector=${s.selector}`);
    if (s.value) parts.push(`value=${s.value}`);
    return parts.join(' ');
  });
  return [
    SYNTHESIS_INSTRUCTIONS,
    '',
    `URL: ${session.url}`,
    'Recorded steps:',
    ...(stepLines.length > 0 ? stepLines : ['(none)']),
  ].join('\n');
}

/** Strips a ```json ... ``` (or bare ``` ... ```) fence if the model wrapped its JSON in one. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fence?.[1] ?? trimmed).trim();
}

/** Parses + validates the model response into flows, throwing a typed error on bad output. */
export function parseFlows(raw: string): SynthFlow[] {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch (err) {
    throw new ProviderError(
      `Test synthesizer could not parse provider output as JSON: ${(err as Error).message}`,
    );
  }
  const result = SynthResponseSchema.safeParse(data);
  if (!result.success) {
    throw new ProviderError(
      `Test synthesizer received an invalid flow schema: ${result.error.message}`,
    );
  }
  return result.data.flows;
}

function stepSignature(step: SynthStep): string {
  return [step.kind, step.role, step.name, step.label, step.value, step.url, step.text]
    .map((p) => p ?? '')
    .join('|');
}

function signatureSet(flow: SynthFlow): Set<string> {
  return new Set(flow.steps.map(stepSignature));
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * Removes overlapping flows: a flow whose step-set is contained in another flow's step-set is
 * dropped in favour of the larger (superset) flow. Identical flows collapse to one. Original
 * ordering of the survivors is preserved.
 */
export function dedupeFlows(flows: SynthFlow[]): SynthFlow[] {
  const indexed = flows.map((flow, index) => ({ flow, index, sig: signatureSet(flow) }));
  // Consider larger flows first so a smaller overlapping flow is dropped, not the superset.
  const bySize = [...indexed].sort((a, b) => b.sig.size - a.sig.size || a.index - b.index);
  const kept: typeof indexed = [];
  for (const cand of bySize) {
    if (!kept.some((k) => isSubset(cand.sig, k.sig))) kept.push(cand);
  }
  const keptIndexes = new Set(kept.map((k) => k.index));
  return flows.filter((_, index) => keptIndexes.has(index));
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function jsonStr(value: string | undefined): string {
  return JSON.stringify(value ?? '');
}

function renderStep(step: SynthStep, fallbackUrl: string): string {
  switch (step.kind) {
    case 'goto':
      return `  await page.goto(${jsonStr(step.url ?? fallbackUrl)});`;
    case 'click':
      return `  await page.getByRole(${jsonStr(step.role ?? 'button')}, { name: ${jsonStr(
        step.name,
      )} }).click();`;
    case 'fill':
      return `  await page.getByLabel(${jsonStr(step.label ?? step.name)}).fill(${jsonStr(
        step.value,
      )});`;
    case 'expectVisible':
    case 'expectText':
      return `  await expect(page.getByText(${jsonStr(step.text)})).toBeVisible();`;
    default: {
      const never: never = step.kind;
      throw new ProviderError(`Unknown synthesized step kind: ${String(never)}`);
    }
  }
}

/** Renders a single flow into a Playwright spec using role-based locators, returning its tags. */
export function renderSpec(
  flow: SynthFlow,
  url: string,
  baseTags: string[] = ['@e2e'],
): { content: string; tags: string[] } {
  const tags = uniq([...baseTags, ...flow.tags]);
  const tagList = tags.map((t) => `'${t}'`).join(', ');
  const body = flow.steps.map((s) => renderStep(s, url)).join('\n');
  const content = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${JSON.stringify(flow.name)}, { tag: [${tagList}] }, async ({ page }) => {`,
    body,
    '});',
    '',
  ].join('\n');
  return { content, tags };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'flow';
}

function uniquePath(dir: string, name: string, used: Set<string>): string {
  const base = slugify(name);
  let candidate = `${dir}/${base}.spec.ts`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${dir}/${base}-${n}.spec.ts`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

export interface SynthesizerOptions {
  /** Directory generated specs are pathed under. Defaults to `tests/generated`. */
  testDir?: string;
  /** Tags applied to every generated spec. Defaults to `['@e2e']`. */
  baseTags?: string[];
}

/**
 * `AiTestSynthesizer` implements {@link TestSynthesizer}. It prompts the injected provider to
 * distil a recorded session into distinct user flows, dedupes overlapping flows, and renders
 * each survivor into a tagged Playwright spec with role-based locators.
 */
export class AiTestSynthesizer implements TestSynthesizer {
  private readonly testDir: string;
  private readonly baseTags: string[];

  constructor(opts: SynthesizerOptions = {}) {
    this.testDir = opts.testDir ?? 'tests/generated';
    this.baseTags = opts.baseTags ?? ['@e2e'];
  }

  async synthesize(session: RecordedSession, provider: LLMProvider): Promise<GeneratedTest[]> {
    const prompt = buildSynthesisPrompt(session);
    const raw = await provider.generateText(prompt);
    const flows = dedupeFlows(parseFlows(raw));
    const usedPaths = new Set<string>();
    return flows.map((flow) => {
      const { content, tags } = renderSpec(flow, session.url, this.baseTags);
      const path = uniquePath(this.testDir, flow.name, usedPaths);
      return { path, content, tags };
    });
  }
}

/** Convenience factory mirroring the platform's `create*` style. */
export function createSynthesizer(opts?: SynthesizerOptions): TestSynthesizer {
  return new AiTestSynthesizer(opts);
}
