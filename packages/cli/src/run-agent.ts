import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AI_PROVIDERS,
  ConfigError,
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
import { createProvider, createStrategy, type CreateProviderOptions } from '@warden/agent';
import { createEngine, type EngineDeps } from '@warden/runner';
import { firePluginHooks } from '@warden/orchestrator';

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
  /**
   * Overrides `ai.provider` from `warden.config.*` for this run only. Present so a caller that
   * cannot edit the repo's config — CI passing an input through — can still choose the provider.
   * An unrecognized name is an error, not a silent fall-through to the configured provider: a
   * run that used a different model than the one asked for must not report as the one asked for.
   */
  provider?: string;
  /** Overrides `ai.model` for this run only. Same reason as {@link RunAgentOptions.provider}. */
  model?: string;
  /** Working directory config is loaded from. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Run against a stub that calls no model, for exercising the wiring without spending tokens.
   * Opt-in only: the run is announced on stderr, `AgentOutput.provider` is `"stub"`, and the
   * markdown report opens with a banner saying no model was called.
   */
  stubProvider?: boolean;
}

/**
 * The stub used by `stubProvider`. It is deliberately not `fakeProvider()` from
 * `@warden/core/testing`: the shipped CLI reaching for a test double is what let the stub be
 * substituted silently in the first place, and this one answers with text no reader could
 * mistake for analysis.
 */
function stubLLMProvider(): LLMProvider {
  const refusal = 'STUB PROVIDER — no model was called.';
  return {
    name: 'stub',
    async generateText() {
      return refusal;
    },
    async generateWithTools() {
      return { text: refusal, toolCalls: [], raw: {} };
    },
  };
}

/** Prepended to the markdown report of a stub run, so the report cannot be read as a result. */
const STUB_BANNER =
  '> **Stub provider — no model was called.** This report was produced by ' +
  '`warden agent --stub-provider` and contains no analysis.\n\n';

/** Collaborators {@link runAgent} can use instead of a real LLM/browser. */
export interface RunAgentDeps {
  /** Injected in tests instead of loading `warden.config.*` from disk. */
  config?: WardenConfig;
  /** Injected in tests instead of the real provider selection, `createProvider(cfg.ai)`. */
  provider?: LLMProvider;
  /**
   * Forwarded to `createProvider` — injected SDK clients and the environment API keys are read
   * from. Lets a test exercise real provider selection without credentials or a network.
   */
  providerOptions?: CreateProviderOptions;
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
 * Returns `cfg` with `ai.provider`/`ai.model` replaced by the run's overrides. The whole config
 * is rewritten (not just the provider construction) so the strategy sees the same `ai` block the
 * provider was built from.
 */
function applyAiOverrides(cfg: WardenConfig, opts: RunAgentOptions): WardenConfig {
  if (opts.provider === undefined && opts.model === undefined) return cfg;

  let provider = cfg.ai.provider;
  if (opts.provider !== undefined) {
    const named = AI_PROVIDERS.find((p) => p === opts.provider);
    if (!named) {
      throw new ConfigError(
        `Unknown AI provider "${opts.provider}". Expected one of: ${AI_PROVIDERS.join(', ')}.`,
      );
    }
    provider = named;
  }

  const model = opts.model !== undefined && opts.model !== '' ? opts.model : undefined;
  return {
    ...cfg,
    ai: {
      ...cfg.ai,
      provider,
      ...(model !== undefined ? { model } : {}),
      // Ollama reads its own model id, so a `--model` that did not reach it would be a flag the
      // caller set and the run ignored.
      ...(model !== undefined && provider === 'ollama'
        ? { ollama: { ...cfg.ai.ollama, model } }
        : {}),
    },
  };
}

/**
 * Picks an `LLMProvider` — the injected one, else whatever `ai.provider` resolves to via
 * `createProvider` — picks the requested `AgentStrategy`, runs it, and writes the resulting
 * `AgentOutput` as JSON to `output`.
 *
 * There is no silent keyless mode. A missing credential throws out of `createProvider` before
 * a browser is launched or a file written, because the alternative — running a stub — produces
 * an `AgentOutput` byte-identical to a real run that found nothing. `--stub-provider` still
 * exercises the wiring, but says so in the report it writes.
 */
export async function runAgent(
  opts: RunAgentOptions,
  deps: RunAgentDeps = {},
): Promise<AgentOutput> {
  const cwd = opts.cwd ?? process.cwd();
  const loaded = deps.config ?? (await loadConfig(cwd));
  const cfg = applyAiOverrides(loaded, opts);

  // Before the browser launch below: a run with no model is refused, not begun.
  const provider =
    deps.provider ??
    (opts.stubProvider ? stubLLMProvider() : createProvider(cfg.ai, deps.providerOptions));
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
    const ran = await strategyImpl.run(input);
    // Stamped here rather than in each strategy: the provider is chosen at this level, and a
    // report that does not name what produced it cannot be told apart from one that did.
    const result: AgentOutput = {
      ...ran,
      provider: provider.name,
      ...(opts.stubProvider === true && {
        markdownReport: STUB_BANNER + ran.markdownReport,
      }),
    };

    for (const finding of result.findings) {
      await firePluginHooks(cfg.plugins, { hook: 'onBugFound', bug: finding });
    }

    await fs.mkdir(path.dirname(opts.output), { recursive: true });
    await fs.writeFile(opts.output, JSON.stringify(result, null, 2), 'utf-8');
    return result;
  } finally {
    if (ownsBrowser && browser) {
      await browser.close();
    }
  }
}
