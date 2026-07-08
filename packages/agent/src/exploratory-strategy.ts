import {
  BrowserError,
  type AgentInput,
  type AgentOutput,
  type AgentStrategy,
  type ExploratoryFinding,
  type Tool,
} from '@warden/core';
import { renderCujMissionBrief } from '@warden/cuj';
import { EXPLORATORY_SYSTEM_PROMPT } from './prompts';
import {
  asRecord,
  normalizeSeverity,
  normalizeSteps,
  summarizeChange,
  summarizeFixtures,
} from './strategy-support';

/** Tool the model calls to report a single bug it found while exploring. */
const REPORT_FINDING_TOOL: Tool = {
  name: 'report_finding',
  description: 'Report a single bug or issue discovered while exploring the application.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short summary of the issue.' },
      severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
      steps: { type: 'array', items: { type: 'string' }, description: 'Steps to reproduce.' },
      expected: { type: 'string', description: 'Expected behaviour.' },
      actual: { type: 'string', description: 'Actual (buggy) behaviour.' },
    },
    required: ['title', 'severity', 'expected', 'actual'],
  },
};

const SEVERITY_ORDER: Record<ExploratoryFinding['severity'], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * Exploratory strategy — "browse and break things". Drives the injected
 * {@link BrowserSession} to probe the changed surface, asks the provider (Claude) to reason
 * about what to attack, and turns the model's `report_finding` tool calls into
 * {@link ExploratoryFinding}s plus a Markdown QA report.
 */
export class ExploratoryStrategy implements AgentStrategy {
  readonly name = 'exploratory' as const;

  async run(input: AgentInput): Promise<AgentOutput> {
    const { browser, provider, config } = input;
    if (!browser) {
      throw new BrowserError('Exploratory strategy requires a BrowserSession (input.browser).');
    }

    const targetUrl = input.url ?? '/';
    await browser.goto(targetUrl);
    const page = await browser.readPage();
    const screenshotPath = 'exploratory-initial.png';
    await browser.screenshot(screenshotPath);
    // Any UI change should also be exercised on a mobile viewport.
    const mobile = config.browser.mobileViewport;
    await browser.setViewport(mobile.width, mobile.height);

    // Additive: when a CUJ is supplied as the mission brief, walk its ordered steps so the
    // model explores the journey that matters rather than a bare URL. Behaviour is unchanged
    // when `input.cuj` is absent.
    if (input.cuj) {
      const orderedSteps = [...input.cuj.steps].sort((a, b) => a.order - b.order);
      for (const step of orderedSteps) {
        await browser.act(`CUJ step ${step.order}: ${step.name}`);
      }
    }

    const promptParts: string[] = [];
    if (input.cuj) {
      promptParts.push(renderCujMissionBrief(input.cuj), '');
    }
    promptParts.push(
      `Target URL: ${targetUrl}`,
      `Page title: ${page.title}`,
      `Visible text (truncated): ${page.text.slice(0, 2000)}`,
      '',
      'Change under test:',
      summarizeChange(input.changeSurface, input.diff),
    );

    if (input.fixtures) {
      promptParts.push(
        '',
        summarizeFixtures(input.fixtures),
        '',
        'Reference these real seeded record identifiers in your findings instead of guessing values ' +
          'from the page.',
      );
    }

    promptParts.push(
      '',
      'Explore the application and call report_finding for every issue you find.',
    );
    const prompt = promptParts.join('\n');

    const result = await provider.generateWithTools(prompt, [REPORT_FINDING_TOOL], {
      systemPrompt: EXPLORATORY_SYSTEM_PROMPT,
      model: config.ai.model,
    });

    const findings = result.toolCalls
      .filter((call) => call.name === 'report_finding')
      .map((call) => toFinding(call.input, screenshotPath))
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    return {
      findings,
      markdownReport: renderReport(targetUrl, findings, result.text),
    };
  }
}

function toFinding(input: unknown, screenshotPath: string): ExploratoryFinding {
  const record = asRecord(input);
  return {
    title: typeof record.title === 'string' ? record.title : 'Untitled finding',
    severity: normalizeSeverity(record.severity),
    steps: normalizeSteps(record.steps),
    expected: typeof record.expected === 'string' ? record.expected : '',
    actual: typeof record.actual === 'string' ? record.actual : '',
    screenshotPath:
      typeof record.screenshotPath === 'string' ? record.screenshotPath : screenshotPath,
  };
}

function renderReport(
  targetUrl: string,
  findings: ExploratoryFinding[],
  summary: string | undefined,
): string {
  const lines: string[] = ['# Exploratory QA Report', '', `**Target:** ${targetUrl}`, ''];

  if (summary && summary.trim().length > 0) {
    lines.push('## Summary', '', summary.trim(), '');
  }

  lines.push(`## Findings (${findings.length})`, '');
  if (findings.length === 0) {
    lines.push('No issues were found during exploration.');
  } else {
    for (const finding of findings) {
      lines.push(`### [${finding.severity}] ${finding.title}`, '');
      if (finding.steps.length > 0) {
        lines.push('**Steps to reproduce:**');
        finding.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
        lines.push('');
      }
      lines.push(`**Expected:** ${finding.expected}`);
      lines.push(`**Actual:** ${finding.actual}`);
      if (finding.screenshotPath) {
        lines.push(`**Screenshot:** ${finding.screenshotPath}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}
