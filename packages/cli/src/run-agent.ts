import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  loadConfig,
  type AgentInput,
  type AgentOutput,
  type AgentStrategy,
  type BrowserSession,
  type ChangeSurface,
  type DiffFile,
  type FailureContext,
  type LLMProvider,
  type StrategyName,
  type WardenConfig,
} from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import { createProvider, createStrategy } from '@warden/agent';
import { createEngine, type EngineDeps } from '@warden/runner';

/** Options for {@link runAgent}. */
export interface RunAgentOptions {
  /** Which of the three V1 agent strategies to run. */
  strategy: StrategyName;
  /** Target URL for the exploratory strategy (also used as the browser's `baseUrl`). */
  url?: string;
  /** The PR this run is associated with, for logging/traceability. */
  prNumber?: number;
  /** Path the `AgentOutput` JSON is written to. */
  output: string;
  /** Working directory config is loaded from. Defaults to `process.cwd()`. */
  cwd?: string;
}

/** Collaborators {@link runAgent} can use instead of a real LLM/browser. */
export interface RunAgentDeps {
  /** Injected in tests instead of loading `warden.config.*` from disk. */
  config?: WardenConfig;
  /**
   * Injected in tests instead of the real provider selection: `createProvider(cfg.ai)` when
   * `ANTHROPIC_API_KEY` is set, else `fakeProvider()`.
   */
  provider?: LLMProvider;
  /** Injected in tests instead of `createStrategy(opts.strategy)`. */
  strategy?: AgentStrategy;
  /**
   * Injected in tests instead of launching a real browser (only needed by the exploratory
   * strategy). When omitted for `strategy: 'exploratory'`, a real engine is launched from
   * `cfg.browser` and closed after the run.
   */
  browser?: BrowserSession;
  diff?: DiffFile[];
  changeSurface?: ChangeSurface;
  /** Required by the healer strategy. */
  failure?: FailureContext;
  /** Forwarded to `createEngine` when a real browser must be launched. */
  engineDeps?: EngineDeps;
}

/**
 * Picks an `LLMProvider` — the injected one, else the real Anthropic provider when
 * `ANTHROPIC_API_KEY` is set, else `fakeProvider()` so the command runs keyless in tests/CI —
 * picks the requested `AgentStrategy`, runs it, and writes the resulting `AgentOutput` as JSON
 * to `output`.
 */
export async function runAgent(
  opts: RunAgentOptions,
  deps: RunAgentDeps = {},
): Promise<AgentOutput> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = deps.config ?? (await loadConfig(cwd));

  const provider =
    deps.provider ?? (process.env.ANTHROPIC_API_KEY ? createProvider(cfg.ai) : fakeProvider());
  const strategyImpl = deps.strategy ?? createStrategy(opts.strategy);

  let browser = deps.browser;
  let ownsBrowser = false;
  if (!browser && opts.strategy === 'exploratory') {
    const engine = createEngine(cfg.browser, deps.engineDeps);
    browser = await engine.launch({
      headless: cfg.browser.headless,
      viewport: cfg.browser.viewport,
      timeout: cfg.browser.timeout,
      ...(opts.url !== undefined && { baseUrl: opts.url }),
    });
    ownsBrowser = true;
  }

  const input: AgentInput = {
    provider,
    config: cfg,
    ...(browser !== undefined && { browser }),
    ...(deps.diff !== undefined && { diff: deps.diff }),
    ...(deps.changeSurface !== undefined && { changeSurface: deps.changeSurface }),
    ...(opts.url !== undefined && { url: opts.url }),
    ...(deps.failure !== undefined && { failure: deps.failure }),
  };

  try {
    const result = await strategyImpl.run(input);
    await fs.mkdir(path.dirname(opts.output), { recursive: true });
    await fs.writeFile(opts.output, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  } finally {
    if (ownsBrowser && browser) {
      await browser.close();
    }
  }
}
