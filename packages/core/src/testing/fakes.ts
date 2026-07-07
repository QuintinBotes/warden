import type { LLMProvider } from '../llm';
import type { BrowserSession, PageState } from '../browser';
import type { Reporter } from '../reporter';
import type { ChangeSurface } from '../change-surface';
import { type TestExecution, TestExecutionSchema } from '../schema';

/**
 * Test doubles and fixtures. Wave-1 agents import these from `@warden/core/testing` so
 * each package can be unit-tested against fakes it owns — never against a sibling package
 * that is being built in parallel. This is what makes the swarm's waves independent.
 */

export interface FakeProvider extends LLMProvider {
  calls: { method: string; prompt: string }[];
}

export function fakeProvider(
  opts: {
    text?: string;
    toolCalls?: { name: string; input: unknown }[];
  } = {},
): FakeProvider {
  const calls: { method: string; prompt: string }[] = [];
  return {
    name: 'fake',
    calls,
    async generateText(prompt) {
      calls.push({ method: 'generateText', prompt });
      return opts.text ?? 'FAKE_RESPONSE';
    },
    async generateWithTools(prompt) {
      calls.push({ method: 'generateWithTools', prompt });
      return { text: opts.text ?? '', toolCalls: opts.toolCalls ?? [], raw: {} };
    },
  };
}

export interface FakeBrowserSession extends BrowserSession {
  actions: string[];
}

export function fakeBrowserSession(
  opts: {
    page?: PageState;
    extractValue?: unknown;
  } = {},
): FakeBrowserSession {
  const actions: string[] = [];
  const page: PageState = opts.page ?? { url: 'http://localhost:3000/', title: 'Fake', text: '' };
  return {
    actions,
    async goto(url) {
      actions.push(`goto ${url}`);
    },
    async click(role, name) {
      actions.push(`click ${role} ${name}`);
    },
    async fill(label, value) {
      actions.push(`fill ${label} ${value}`);
    },
    async act(instruction) {
      actions.push(`act ${instruction}`);
    },
    async extract<T>(): Promise<T> {
      return (opts.extractValue ?? {}) as T;
    },
    async screenshot(path) {
      actions.push(`screenshot ${path}`);
    },
    async readPage() {
      return page;
    },
    async setViewport(width, height) {
      actions.push(`viewport ${width}x${height}`);
    },
    async close() {
      actions.push('close');
    },
  };
}

export interface FakeReporter extends Reporter {
  reported: TestExecution[];
}

export function fakeReporter(): FakeReporter {
  const reported: TestExecution[] = [];
  return {
    name: 'fake',
    reported,
    async report(execution) {
      reported.push(execution);
    },
  };
}

export function fixtureChangeSurface(overrides: Partial<ChangeSurface> = {}): ChangeSurface {
  return {
    changedFiles: ['apps/checkout/page.tsx'],
    changedModules: ['apps/checkout'],
    testTags: ['@apps/checkout'],
    hasSharedChanges: false,
    affectedApiRoutes: [],
    affectedComponents: [],
    riskScore: 5,
    riskReasons: [{ pattern: 'checkout', reason: 'payment flow change', score: 5 }],
    ...overrides,
  };
}

export function fixtureExecution(overrides: Partial<TestExecution> = {}): TestExecution {
  return TestExecutionSchema.parse({
    id: 'EX-1',
    testPlanId: 'TP-1',
    triggerType: 'pr',
    triggerRef: '482',
    environment: 'preview-pr-482',
    startedAt: '2026-07-07T12:00:00.000Z',
    results: [
      { testCaseId: 'TC-042', status: 'PASS', duration: 100, retries: 0, flakeFlag: false },
    ],
    ...overrides,
  });
}
