import { z } from 'zod';
import {
  LearningChapterSchema,
  ProviderError,
  type GenerateOptions,
  type LLMProvider,
  type TestExecution,
  type Tool,
} from '@warden/core';

/**
 * Structured content the LLM authors for a single tested flow. The `script` is the narrated
 * transcript that will voice the learning video; `chapters` mark navigable timestamps;
 * `article` is a written walkthrough. Only `script` is required — everything else is derived
 * when the provider omits it.
 */
export const AuthoredContentSchema = z.object({
  title: z.string().min(1).optional(),
  script: z.string().min(1),
  chapters: z.array(LearningChapterSchema).optional(),
  article: z.string().min(1).optional(),
});
export type AuthoredContent = z.infer<typeof AuthoredContentSchema>;

/** The tool we hand the provider so it returns structured content rather than free text. */
export const AUTHOR_LEARNING_MODULE_TOOL: Tool = {
  name: 'author_learning_module',
  description:
    'Author a narrated learning module for a passing end-to-end user flow: a spoken narration ' +
    'script, chapter markers, and a written article.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short, human-friendly module title.' },
      script: {
        type: 'string',
        description: 'The full spoken narration / transcript for the video, in order.',
      },
      chapters: {
        type: 'array',
        description: 'Navigable chapter markers into the narration.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            atMs: { type: 'number', description: 'Offset from the start, in milliseconds.' },
          },
          required: ['title', 'atMs'],
        },
      },
      article: { type: 'string', description: 'A written walkthrough of the flow, in Markdown.' },
    },
    required: ['script'],
  },
};

export const AUTHOR_SYSTEM_PROMPT =
  'You are a technical educator. Given a passing end-to-end test flow, produce a concise, ' +
  'accurate learning module that teaches a new team member how the feature works. Narrate ' +
  'what the user does and why. Never invent behaviour that was not exercised by the flow.';

export interface AuthorContext {
  flow: string;
  execution: TestExecution;
}

/** Builds the user prompt describing the flow the provider should narrate. */
export function buildAuthorPrompt(ctx: AuthorContext): string {
  return [
    `Author a learning module for the tested flow "${ctx.flow}".`,
    `It comes from test execution "${ctx.execution.id}" in environment "${ctx.execution.environment}".`,
    'Call the author_learning_module tool with a narration script, chapters, and an article.',
  ].join('\n');
}

/**
 * Asks the injected {@link LLMProvider} to author content for a flow. Prefers the structured
 * tool call; falls back to any raw text the model returned, then to a plain text generation.
 * Throws {@link ProviderError} when the provider yields nothing usable so callers get a
 * typed, machine-branchable failure.
 */
export async function authorContent(
  provider: LLMProvider,
  ctx: AuthorContext,
  _cfg: unknown,
): Promise<AuthoredContent> {
  const prompt = buildAuthorPrompt(ctx);
  const options: GenerateOptions = { systemPrompt: AUTHOR_SYSTEM_PROMPT, temperature: 0 };

  const result = await provider.generateWithTools(prompt, [AUTHOR_LEARNING_MODULE_TOOL], options);
  const call = result.toolCalls[0];
  if (call) {
    const parsed = AuthoredContentSchema.safeParse(call.input);
    if (parsed.success) return parsed.data;
  }

  if (result.text && result.text.trim().length > 0) {
    return { script: result.text };
  }

  const text = await provider.generateText(prompt, options);
  if (text && text.trim().length > 0) {
    return { script: text };
  }

  throw new ProviderError(
    `Provider "${provider.name}" returned no learning script for flow "${ctx.flow}".`,
  );
}
