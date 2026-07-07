import { join } from 'node:path';
import {
  contentId,
  LearningModuleSchema,
  type LearningContentGenerator,
  type LearningModule,
  type LLMProvider,
  type TestExecution,
  type TestResult,
  type WardenConfig,
} from '@warden/core';
import { authorContent, type AuthoredContent } from './author';
import { buildFfmpegArgs, defaultFfmpegRunner, type FfmpegRunner } from './ffmpeg';
import { defaultWriter, type StudioWriter } from './writer';

/** Injectable dependencies. Defaults touch the real fs/ffmpeg; tests pass fakes for both. */
export interface LearningStudioDeps {
  writer?: StudioWriter;
  ffmpeg?: FfmpegRunner;
}

/** A flow worth teaching: a passing test result that captured replayable media. */
export interface MeaningfulFlow {
  flow: string;
  result: TestResult;
  /** Recorded video clips for the flow, most-canonical first. */
  videos: string[];
  /** Captured screenshots for the flow. */
  screenshots: string[];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function collectMedia(result: TestResult, kind: 'video' | 'screenshot'): string[] {
  const out: string[] = [];
  if (kind === 'video' && result.videoPath) out.push(result.videoPath);
  if (kind === 'screenshot' && result.screenshotPath) out.push(result.screenshotPath);
  for (const artifact of result.artifacts) {
    if (artifact.type === kind) out.push(artifact.path);
  }
  return dedupe(out);
}

/**
 * Selects the flows worth turning into learning content: results that PASSED (a working flow
 * to teach) and captured at least one video or screenshot (something to stitch/replay).
 * Deterministic and order-preserving.
 */
export function selectMeaningfulFlows(execution: TestExecution): MeaningfulFlow[] {
  const flows: MeaningfulFlow[] = [];
  for (const result of execution.results) {
    if (result.status !== 'PASS') continue;
    const videos = collectMedia(result, 'video');
    const screenshots = collectMedia(result, 'screenshot');
    if (videos.length === 0 && screenshots.length === 0) continue;
    flows.push({ flow: result.testCaseId, result, videos, screenshots });
  }
  return flows;
}

/** Renders a default Markdown article from the authored content when the provider omits one. */
function renderArticle(title: string, authored: AuthoredContent): string {
  const lines = [`# ${title}`, '', authored.script.trim(), ''];
  if (authored.chapters && authored.chapters.length > 0) {
    lines.push('## Chapters', '');
    for (const chapter of authored.chapters) {
      lines.push(`- \`${chapter.atMs}ms\` — ${chapter.title}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Turns tested flows into narrated learning videos + articles. Injectable end-to-end: the
 * LLM provider is passed to {@link generate}, and the fs writer + ffmpeg runner are injected
 * via the constructor, so the whole pipeline is unit-testable without a network, disk, or
 * `ffmpeg` binary.
 */
export class StudioLearningContentGenerator implements LearningContentGenerator {
  private readonly writer: StudioWriter;
  private readonly ffmpeg: FfmpegRunner;

  constructor(deps: LearningStudioDeps = {}) {
    this.writer = deps.writer ?? defaultWriter();
    this.ffmpeg = deps.ffmpeg ?? defaultFfmpegRunner();
  }

  async generate(
    execution: TestExecution,
    provider: LLMProvider,
    cfg: WardenConfig,
  ): Promise<LearningModule[]> {
    const settings = cfg.learningContent;
    // Disabled: emit nothing and — importantly — write nothing.
    if (!settings.enabled) return [];

    const flows = selectMeaningfulFlows(execution);
    if (flows.length === 0) return [];

    await this.writer.mkdir(settings.publishDir);

    const modules: LearningModule[] = [];
    for (const flow of flows) {
      modules.push(await this.buildModule(execution, provider, cfg, flow));
    }
    return modules;
  }

  private async buildModule(
    execution: TestExecution,
    provider: LLMProvider,
    cfg: WardenConfig,
    flow: MeaningfulFlow,
  ): Promise<LearningModule> {
    const settings = cfg.learningContent;
    const authored = await authorContent(provider, { flow: flow.flow, execution }, cfg);

    // Deterministic ids: same execution + flow always yields the same embedId/id.
    const key = `${execution.id}:${flow.flow}`;
    const embedId = contentId('embed', key);
    const id = contentId('LM', key);
    const title = authored.title ?? `How it works: ${flow.flow}`;

    const wantVideo = settings.format === 'video' || settings.format === 'both';
    const wantArticle = settings.format === 'article' || settings.format === 'both';

    let videoPath: string | undefined;
    let transcriptPath: string | undefined;
    let articlePath: string | undefined;

    if (wantVideo) {
      videoPath = join(settings.publishDir, `${embedId}.mp4`);
      // Prefer recorded clips; fall back to a screenshot slideshow.
      const sources = flow.videos.length > 0 ? flow.videos : flow.screenshots;
      await this.ffmpeg.run(buildFfmpegArgs(sources, videoPath));

      // The transcript is exactly the authored narration — it voices the video.
      transcriptPath = join(settings.publishDir, `${embedId}.transcript.txt`);
      await this.writer.writeFile(transcriptPath, authored.script);
    }

    if (wantArticle) {
      articlePath = join(settings.publishDir, `${embedId}.article.md`);
      const article = authored.article ?? renderArticle(title, authored);
      await this.writer.writeFile(articlePath, article);
    }

    const learningModule: LearningModule = LearningModuleSchema.parse({
      id,
      title,
      sourceExecutionId: execution.id,
      flow: flow.flow,
      script: authored.script,
      chapters: authored.chapters ?? [{ title, atMs: 0 }],
      videoPath,
      transcriptPath,
      articlePath,
      embedId,
    });
    return learningModule;
  }
}

/** Constructs a {@link StudioLearningContentGenerator}. Pass fakes in tests, nothing in prod. */
export function createLearningStudio(deps?: LearningStudioDeps): StudioLearningContentGenerator {
  return new StudioLearningContentGenerator(deps);
}
