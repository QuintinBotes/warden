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
| **Anthropic (Claude)** | ✅ v1, default | `ai.provider: 'anthropic'` |
| OpenAI | v2 | `ai.provider: 'openai'` |
| Gemini | v2 | `ai.provider: 'gemini'` |
| Ollama (local/self-hosted) | v2 | `ai.provider: 'ollama'` |

In v1, selecting a non-Anthropic provider raises a clear `ProviderError` pointing you to v2. The interface is stable, so v2 providers are drop-in.

### Local models & fallback

`ai.fallbackProvider: 'ollama'` lets Warden run against a local model when no cloud key is present — useful for forks, air-gapped runners, and cost-sensitive routine PRs.

```ts
export default defineConfig({
  ai: {
    provider: 'anthropic',
    fallbackProvider: 'ollama',
    ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3:32b' },
  },
});
```

## Browser engines

Deterministic interactions and AI-driven ones live behind one `BrowserSession` interface, so engines are interchangeable.

| Engine | Status | Best for |
|--------|--------|----------|
| **Playwright** | ✅ v1, default | Headless CI. Fast, deterministic, reproducible. |
| **Claude-Chrome** | ✅ v1 | Local runs in your **real Chrome** via the Claude browser extension. |
| Stagehand | v2 | Hybrid: Playwright for stable flows, AI for dynamic UIs. |

### Playwright (CI default)

Role-based, deterministic, and headless. Warden configures the context to **capture video, screenshots, and traces**, then lifts those media paths into the report so the dashboard can replay the run. This is the engine the GitHub Action uses.

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
