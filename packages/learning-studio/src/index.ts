/**
 * `@warden/learning-studio` (WS-F) — the Learning Content Studio. It turns tested,
 * passing end-to-end flows into narrated learning videos and written articles: an LLM
 * authors the script/chapters/article, an injected ffmpeg runner stitches the captured
 * media into a video, and an injected fs writer publishes the artifacts. Everything is
 * built against the `@warden/core` contract and is fully injectable, so the pipeline runs
 * hermetically in unit tests without a network, disk, or `ffmpeg` binary.
 */

// Main generator
export {
  StudioLearningContentGenerator,
  createLearningStudio,
  selectMeaningfulFlows,
  type LearningStudioDeps,
  type MeaningfulFlow,
} from './learning-studio';

// Authoring seam (LLM)
export {
  AUTHOR_LEARNING_MODULE_TOOL,
  AUTHOR_SYSTEM_PROMPT,
  AuthoredContentSchema,
  authorContent,
  buildAuthorPrompt,
  type AuthorContext,
  type AuthoredContent,
} from './author';

// Video-stitching seam (ffmpeg)
export { FfmpegError, buildFfmpegArgs, defaultFfmpegRunner, type FfmpegRunner } from './ffmpeg';

// Filesystem seam
export { defaultWriter, type StudioWriter } from './writer';
