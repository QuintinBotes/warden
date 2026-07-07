/**
 * Warden's own configuration — the platform dogfoods itself.
 *
 * This repo *builds* `@warden/core`, so (unlike a consumer repo) the root config avoids
 * importing `defineConfig`; `loadConfig` validates this object and fills defaults. In your
 * own project, prefer:  `import { defineConfig } from '@warden/core'; export default defineConfig({...})`.
 *
 * Because this is a library monorepo (not a web app), the self-test workflow mainly
 * exercises the keyless `analyze` and `plan` paths; the AI agent runs only when an
 * ANTHROPIC_API_KEY secret is present.
 *
 * @type {import('@warden/core').WardenConfigInput}
 */
export default {
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  },
  scope: {
    // Treat the shared contract surface and build config as full-suite triggers.
    sharedPaths: ['packages/core/', 'tsconfig.base.json'],
    highRiskPatterns: ['core', 'schema', 'config'],
  },
  gates: {
    blockOnCritical: true,
    blockOnPassRateBelowPercent: 90,
  },
};
