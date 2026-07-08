import type {
  DraftPrResult,
  FileAccess,
  GenerateOptions,
  GitHubAccess,
  HealRateSummary,
  LLMProvider,
  PageState,
  PrRef,
  RepoTarget,
  ToolCallResult,
} from '@warden/core';
import type { LocatingSession } from './locator-resolver.js';
import type { HealMetricsEmitter } from './run.js';

/**
 * Package-local test doubles for `@warden/proactive-healer`. Built on the `@warden/core`
 * contract types so every unit test is hermetic — no real browser, GitHub, or LLM. Not bundled
 * into `dist` (never imported by `index.ts`).
 */

/** In-memory {@link FileAccess} backed by a `path -> contents` map. */
export function memFileAccess(tree: Record<string, string>): FileAccess {
  const paths = Object.keys(tree);
  return {
    async listFiles(dir: string): Promise<string[]> {
      const prefix = dir === '' ? '' : dir.endsWith('/') ? dir : `${dir}/`;
      return paths.filter((p) => prefix === '' || p === dir || p.startsWith(prefix)).sort();
    },
    async readFile(path: string): Promise<string | null> {
      return Object.prototype.hasOwnProperty.call(tree, path) ? tree[path]! : null;
    },
  };
}

export interface DraftPrCall {
  repo: RepoTarget;
  branch: string;
  files: { path: string; content: string | null }[];
  title: string;
  body: string;
}

export interface SuggestionCall {
  pr: PrRef;
  files: { path: string; content: string }[];
  summary: string;
}

export interface CheckRunCall {
  pr: PrRef;
  conclusion: 'success' | 'neutral' | 'failure';
  title: string;
  summary: string;
}

export interface RecordingGitHubAccess extends GitHubAccess {
  draftPrCalls: DraftPrCall[];
  suggestionCalls: SuggestionCall[];
  checkRunCalls: CheckRunCall[];
}

/** A recording {@link GitHubAccess}: captures every call; draft-PR `number` counts up from 100. */
export function recordingGitHub(): RecordingGitHubAccess {
  const draftPrCalls: DraftPrCall[] = [];
  const suggestionCalls: SuggestionCall[] = [];
  const checkRunCalls: CheckRunCall[] = [];
  return {
    draftPrCalls,
    suggestionCalls,
    checkRunCalls,
    async openOrUpdateDraftPr(repo, branch, files, title, body): Promise<DraftPrResult> {
      draftPrCalls.push({ repo, branch, files, title, body });
      const number = 100 + draftPrCalls.length;
      return { url: `https://github.com/${repo}/pull/${number}`, number };
    },
    async addPrSuggestions(pr, files, summary): Promise<void> {
      suggestionCalls.push({ pr, files, summary });
    },
    async postCheckRun(pr, conclusion, title, summary): Promise<void> {
      checkRunCalls.push({ pr, conclusion, title, summary });
    },
  };
}

const DEFAULT_PAGE: PageState = {
  url: 'http://localhost:3000/',
  title: 'Preview',
  text: 'roles: button "Purchase"; label "Email address"',
};

export interface FakeLocatingSession extends LocatingSession {
  locateCalls: { kind: 'click' | 'fill'; role: string; name: string }[];
}

/**
 * A fake preview {@link LocatingSession}. When `locate` is supplied it is defined on the session
 * (returning the scripted `matchCount`); when omitted the session has NO `locate` method, so the
 * resolver's "unsupported engine" skip path can be exercised.
 */
export function fakeLocatingSession(
  opts: {
    locate?: (kind: 'click' | 'fill', role: string, name: string) => number;
    page?: PageState;
  } = {},
): FakeLocatingSession {
  const locateCalls: FakeLocatingSession['locateCalls'] = [];
  const page = opts.page ?? DEFAULT_PAGE;
  const session: FakeLocatingSession = {
    locateCalls,
    async goto(): Promise<void> {},
    async click(): Promise<void> {},
    async fill(): Promise<void> {},
    async act(): Promise<void> {},
    async extract<T>(): Promise<T> {
      return {} as T;
    },
    async screenshot(): Promise<void> {},
    async readPage(): Promise<PageState> {
      return page;
    },
    async setViewport(): Promise<void> {},
    async close(): Promise<void> {},
  };
  if (opts.locate) {
    const fn = opts.locate;
    session.locate = async (kind, role, name) => {
      locateCalls.push({ kind, role, name });
      return { matchCount: fn(kind, role, name) };
    };
  }
  return session;
}

export interface ScriptedProviderResponse {
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
}

export interface ScriptedProvider extends LLMProvider {
  calls: { prompt: string; options?: GenerateOptions }[];
}

/**
 * A provider that returns one scripted response per `generateWithTools` call, in order. When the
 * script is exhausted it returns an empty response (no tool call), exercising the suggester's
 * "no proposal" fallback.
 */
export function scriptedProvider(responses: ScriptedProviderResponse[]): ScriptedProvider {
  const calls: { prompt: string; options?: GenerateOptions }[] = [];
  let i = 0;
  return {
    name: 'scripted',
    calls,
    async generateText(prompt, options): Promise<string> {
      calls.push({ prompt, options });
      return responses[i++]?.text ?? '';
    },
    async generateWithTools(prompt, _tools, options): Promise<ToolCallResult> {
      calls.push({ prompt, options });
      const r = responses[i++];
      return { text: r?.text ?? '', toolCalls: r?.toolCalls ?? [], raw: {} };
    },
  };
}

export interface HealEmitCall {
  summary: HealRateSummary;
  meta: { pr?: number; mode: 'proactive' | 'reactive' };
}

export interface RecordingHealMetrics extends HealMetricsEmitter {
  healCalls: HealEmitCall[];
}

/** A {@link HealMetricsEmitter} that records every `emitHeal` call for assertions. */
export function recordingHealMetrics(): RecordingHealMetrics {
  const healCalls: HealEmitCall[] = [];
  return {
    healCalls,
    async emitHeal(summary, meta): Promise<void> {
      healCalls.push({ summary, meta });
    },
  };
}

/** A canonical source PR fixture for publisher/run tests. */
export function fixturePr(overrides: Partial<PrRef> = {}): PrRef {
  return {
    owner: 'org',
    repo: 'shop',
    number: 42,
    headSha: 'abc123',
    headRef: 'feature/redesign',
    ...overrides,
  };
}
