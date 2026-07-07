import type { AgentInput, AgentOutput, AgentStrategy, GeneratedFile } from '@warden/core';
import { GENERATIVE_SYSTEM_PROMPT } from './prompts';
import { featureName, summarizeChange } from './strategy-support';

/**
 * Generative strategy — "write Playwright tests from the diff". Reads the change surface
 * / diff, asks the provider for a single deterministic `.spec.ts` file, and returns it as a
 * {@link GeneratedFile} destined for `tests/e2e/<feature>.spec.ts`.
 */
export class GenerativeStrategy implements AgentStrategy {
  readonly name = 'generative' as const;

  async run(input: AgentInput): Promise<AgentOutput> {
    const { provider, config } = input;
    const feature = featureName(input.changeSurface, input.diff);

    const prompt = [
      `Generate a Playwright E2E test for the "${feature}" feature.`,
      '',
      'Change under test:',
      summarizeChange(input.changeSurface, input.diff),
      '',
      `Output the file for tests/e2e/${feature}.spec.ts.`,
    ].join('\n');

    const content = await provider.generateText(prompt, {
      systemPrompt: GENERATIVE_SYSTEM_PROMPT,
      model: config.ai.model,
    });

    const file: GeneratedFile = {
      path: `tests/e2e/${feature}.spec.ts`,
      content,
    };

    return {
      findings: [],
      generatedFiles: [file],
      markdownReport: renderReport(file),
    };
  }
}

function renderReport(file: GeneratedFile): string {
  const lineCount = file.content.split('\n').length;
  return [
    '# Generated Tests',
    '',
    `Generated **1** Playwright spec (${lineCount} lines):`,
    '',
    `- \`${file.path}\``,
    '',
  ].join('\n');
}
