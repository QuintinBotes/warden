import {
  ProviderError,
  type ImagePart,
  type LLMProvider,
  type PixelDiffResult,
  type VisualCheck,
  type VisualJudge,
  type VisualJudgment,
} from '@warden/core';

/** Options tuning the {@link ProviderVisualJudge}. */
export interface ProviderVisualJudgeOptions {
  /** Sampling temperature for the verdict; defaults to `0` for determinism. */
  temperature?: number;
  /** Model override passed through to the provider. */
  model?: string;
  /**
   * Minimum confidence below which a `render-noise` verdict is upgraded back to `meaningful`
   * (the pixel floor wins). Defaults to `0` — any `render-noise` verdict is honored.
   */
  minConfidence?: number;
}

const RUBRIC = [
  'You are a visual-regression judge. Two screenshots of the same UI are attached: the first is',
  'the approved BASELINE, the second is the new CANDIDATE. A deterministic pixel diff already',
  'confirmed they differ; your only job is to classify WHY.',
  '',
  'Classify the change as exactly one of:',
  '- "meaningful": a real visual regression a reviewer must see (layout shift, clipped/overlapping',
  '  content, missing or moved element, color/contrast change, broken component).',
  '- "render-noise": cosmetically irrelevant rendering variance (anti-aliasing, sub-pixel font',
  '  rendering, harmless 1px jitter) that a human would not consider a bug.',
  '',
  'Respond with ONLY a JSON object, no prose, no code fences:',
  '{"classification":"meaningful"|"render-noise","confidence":<0..1>,"rationale":"<one short line>"}',
].join('\n');

/**
 * `VisualJudge` backed by the configured `LLMProvider`'s multimodal `generateWithImages`.
 *
 * It sends the baseline + candidate (and the changed-pixel ratio for context) with a tight rubric
 * at `temperature: 0` and parses back a `{ classification, confidence, rationale }` verdict. The
 * judge only ever *suppresses* a pixel-confirmed change (`render-noise`); it never invents one, so
 * an unparseable or low-confidence reply defaults to `meaningful` (the pixel floor stands).
 */
export class ProviderVisualJudge implements VisualJudge {
  constructor(
    private readonly provider: LLMProvider,
    private readonly options: ProviderVisualJudgeOptions = {},
  ) {}

  async judge(input: {
    check: VisualCheck;
    baseline: Uint8Array;
    candidate: Uint8Array;
    pixel: PixelDiffResult;
  }): Promise<VisualJudgment> {
    const generateWithImages = this.provider.generateWithImages;
    if (!generateWithImages) {
      throw new ProviderError(
        `Provider "${this.provider.name}" has no generateWithImages; visual AI judge unavailable.`,
      );
    }

    const prompt = [
      RUBRIC,
      '',
      `Module: ${input.check.module}`,
      `Viewport: ${input.check.viewport.name} (${input.check.viewport.width}x${input.check.viewport.height})`,
      `Theme: ${input.check.theme}`,
      `Pixel changedRatio: ${input.pixel.changedRatio.toFixed(6)}`,
      `Changed regions: ${input.pixel.boundingBoxes.length}`,
    ].join('\n');

    const images: ImagePart[] = [
      { mimeType: 'image/png', dataBase64: toBase64(input.baseline) },
      { mimeType: 'image/png', dataBase64: toBase64(input.candidate) },
    ];

    const raw = await generateWithImages.call(this.provider, prompt, images, {
      temperature: this.options.temperature ?? 0,
      ...(this.options.model !== undefined && { model: this.options.model }),
    });

    return this.parseVerdict(raw);
  }

  private parseVerdict(raw: string): VisualJudgment {
    const parsed = extractJson(raw);
    const classification =
      parsed?.classification === 'render-noise' ? 'render-noise' : 'meaningful';
    const confidence =
      typeof parsed?.confidence === 'number'
        ? clamp01(parsed.confidence)
        : classification === 'meaningful'
          ? 1
          : 0.5;
    const rationale =
      typeof parsed?.rationale === 'string' && parsed.rationale.trim().length > 0
        ? parsed.rationale.trim()
        : 'no rationale provided';

    const minConfidence = this.options.minConfidence ?? 0;
    if (classification === 'render-noise' && confidence < minConfidence) {
      return { classification: 'meaningful', confidence, rationale };
    }
    return { classification, confidence, rationale };
  }
}

interface RawVerdict {
  classification?: unknown;
  confidence?: unknown;
  rationale?: unknown;
}

/** Extracts the first JSON object from a model reply, tolerating code fences and surrounding prose. */
function extractJson(raw: string): RawVerdict | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as RawVerdict;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
