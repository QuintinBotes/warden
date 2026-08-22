# AI Providers & Browser Engines

Warden separates two swappable seams: **which model reasons** (the provider) and **which browser executes** (the engine). Both are chosen in [configuration](configuration.md) and implemented behind interfaces in `@warden/core`.

## AI providers

Every AI call goes through the `LLMProvider` interface, so the reasoning engine is a config change, never a code change.

```ts
export interface LLMProvider {
  name: string;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  generateWithTools(prompt: string, tools: Tool[], options?: GenerateOptions): Promise<ToolCallResult>;
}
```

| Provider | Status | Config |
|----------|--------|--------|
| **Anthropic (Claude)** | Available, default | `ai.provider: 'anthropic'` |
| OpenAI | Available | `ai.provider: 'openai'` |
| Gemini | Available | `ai.provider: 'gemini'` |
| Ollama (local/self-hosted) | Available | `ai.provider: 'ollama'` |

Each cloud provider reads its own API key from the environment, and only its own — configuring
`openai` and setting `ANTHROPIC_API_KEY` credentials nothing. Because every provider implements
the same `LLMProvider` interface, switching is a one-line config change with no code changes
anywhere else.

| Provider | Environment variable |
|----------|----------------------|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `gemini` | `GEMINI_API_KEY`, or `GOOGLE_API_KEY` |
| `ollama` | none — it talks to a local daemon |

**A missing key is an error, not a downgrade.** `createProvider` throws, and `warden agent` exits
`1` naming the variable to set, without writing a report. Warden does not substitute a stub: an
agent report written without a model has empty `findings` and reads as a clean pass, so falling
back quietly would convert "could not run" into "found nothing".

For a single run, `warden agent --provider <name> --model <id>` overrides `ai.provider`/`ai.model` without touching the config — the route the GitHub Action's `provider` and `model` inputs take. A name outside the four above is rejected rather than quietly falling back to the configured provider.

### Local models & fallback

`ai.fallbackProvider: 'ollama'` lets Warden run against a local model when no cloud key is present — useful for forks, air-gapped runners, and cost-sensitive routine PRs. This is the supported way to run keyless; without it, a missing key stops the run.

The fallback is only tried when the primary provider has no key, and it is checked for credentials in turn: a fallback that is itself uncredentialed produces the same error, naming the fallback rather than the primary.

```ts
export default defineConfig({
  ai: {
    provider: 'anthropic',
    fallbackProvider: 'ollama',
    ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3:32b' },
  },
});
```

`ollama.baseUrl` is where prompt text is sent, so a config file — which comes from the
repository under test — may only name a **loopback** host there. A remote Ollama is configured
from the environment instead, with `WARDEN_OLLAMA_BASE_URL`, which a pull request cannot write.
See [Configuration](configuration.md#ai--the-ai-engine).

## Browser engines

Deterministic interactions and AI-driven ones live behind one `BrowserSession` interface, so engines are interchangeable.

| Engine | Status | Best for |
|--------|--------|----------|
| **Playwright** | Available, default | Headless CI. Fast, deterministic, reproducible. |
| **Claude-Chrome** | Available | Local runs in your **real Chrome** via the Claude browser extension. |
| Stagehand | Available | Hybrid: Playwright for stable flows, AI for dynamic UIs. |

### Playwright (CI default)

Role-based, deterministic, and headless. Warden configures the context to **capture video, screenshots, and traces**, then lifts those media paths into the report so the dashboard can replay the run. This is the engine the GitHub Action uses.

> **Yours, not one Warden fetched.** `warden run` launches the nearest `node_modules/.bin/playwright` at or above the working directory, or `WARDEN_PLAYWRIGHT_BIN` when you set it. A project with neither fails the run and says so — Warden does not install Playwright on your behalf, because a downloaded one would run against a repo with no config and no specs and report a green run that tested nothing. See [CLI Reference](cli.md#warden-run).

### Claude-Chrome (local-first)

The `claude-chrome` engine drives a real Chrome tab through the Claude-in-Chrome extension — the browser you already have, with your session. It maps `BrowserSession` operations (`goto`, `click`, `fill`, `act`, `extract`, `screenshot`, `readPage`) onto the extension's tools.

> **Local-first.** It requires a running Chrome with the Claude extension and site permission, so it is intended for developer machines, not shared CI. Select it in local config; keep CI on headless Playwright.

```ts
// warden.config.local.ts
export default defineConfig({
  browser: { engine: 'claude-chrome', headless: false },
});
```

### Deterministic vs. AI actions

- Use **deterministic** steps (`click`, `fill`, `goto`) for the 80% of flows that are stable.
- Use **AI** steps (`act`, `extract`) for the 20% that need reasoning about a dynamic UI.

Playwright supports the deterministic half; Claude-Chrome and Stagehand add the AI half. This mirrors the production consensus: Playwright for predictable flows, AI for the parts that need judgment.
