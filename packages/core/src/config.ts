import { z } from 'zod';
import { loadConfig as c12LoadConfig } from 'c12';
import type { QAPlatformPlugin } from './plugin';
import { ConfigError } from './errors';
import { GridConfigSchema } from './grid';

/**
 * The single Warden configuration surface (`warden.config.ts`). Every field has a
 * documented default so a zero-config repo Just Works; `defineConfig` validates and
 * fills defaults, `loadConfig` reads the file from disk (via c12/jiti).
 */

const providerEnum = z.enum(['anthropic', 'openai', 'gemini', 'ollama']);

export const WardenConfigSchema = z.object({
  ai: z
    .object({
      provider: providerEnum.default('anthropic'),
      // A real, current model id. Override per repo; high-risk tiers may bump to Opus.
      model: z.string().default('claude-sonnet-5'),
      fallbackProvider: providerEnum.optional(),
      ollama: z
        .object({
          baseUrl: z.string().default('http://localhost:11434'),
          model: z.string().default('qwen3:32b'),
        })
        .default({}),
    })
    .default({}),
  browser: z
    .object({
      engine: z.enum(['playwright', 'claude-chrome', 'stagehand']).default('playwright'),
      headless: z.boolean().default(true),
      viewport: z
        .object({ width: z.number().default(1280), height: z.number().default(720) })
        .default({}),
      mobileViewport: z
        .object({ width: z.number().default(375), height: z.number().default(667) })
        .default({}),
      timeout: z.number().default(30000),
    })
    .default({}),
  scope: z
    .object({
      highRiskPatterns: z.array(z.string()).default(['auth', 'payment', 'checkout', 'admin']),
      sharedPaths: z.array(z.string()).default(['lib/', 'shared/', 'packages/core/']),
      tagPrefix: z.string().default('@'),
    })
    .default({}),
  tiers: z
    .object({
      smoke: z
        .object({
          tags: z.array(z.string()).default(['@smoke']),
          maxDuration: z.string().default('3m'),
          triggerOn: z.string().default('every_push'),
        })
        .default({}),
      selective: z
        .object({
          triggerOn: z.string().default('pr'),
          useTagsFromDiff: z.boolean().default(true),
        })
        .default({}),
      fullRegression: z
        .object({
          triggerOn: z.string().default('merge_queue'),
          maxDuration: z.string().default('30m'),
        })
        .default({}),
      aiExploratory: z
        .object({
          triggerOn: z.string().default('pr'),
          strategy: z.string().default('exploratory'),
          riskThreshold: z.number().default(4),
        })
        .default({}),
    })
    .default({}),
  reporting: z
    .object({
      ctrf: z.boolean().default(true),
      githubJobSummary: z.boolean().default(true),
      prComment: z.boolean().default(true),
      checkRunAnnotations: z.boolean().default(true),
      prometheus: z
        .object({ enabled: z.boolean().default(false), pushgatewayUrl: z.string().optional() })
        .default({}),
    })
    .default({}),
  gates: z
    .object({
      blockOnCritical: z.boolean().default(true),
      blockOnPassRateBelowPercent: z.number().default(90),
      warnOnHighCount: z.number().default(2),
      flakeQuarantineAfterRuns: z.number().default(3),
    })
    .default({}),
  testManagement: z
    .object({
      requirementsSource: z
        .enum(['github_issues', 'linear', 'jira', 'markdown'])
        .default('github_issues'),
      testCasesDir: z.string().default('tests/cases/'),
      generatedTestsDir: z.string().default('tests/e2e/generated/'),
      commitGeneratedTests: z.boolean().default(true),
    })
    .default({}),
  // ── V2 (additive; all optional with defaults, so V1 configs stay valid) ──────────
  observability: z
    .object({
      enabled: z.boolean().default(false),
      pushgatewayUrl: z.string().optional(),
    })
    .default({}),
  dashboard: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().default(3001),
      dbPath: z.string().default('.warden/warden.sqlite'),
    })
    .default({}),
  recorder: z
    .object({
      enabled: z.boolean().default(false),
      outDir: z.string().default('tests/e2e/recorded/'),
    })
    .default({}),
  integrations: z
    .object({
      provider: z.enum(['none', 'linear', 'jira', 'github-projects']).default('none'),
    })
    .default({}),
  performance: z
    .object({
      enabled: z.boolean().default(false),
      p95LatencyMs: z.number().default(500), // existing: k6 API-latency budget
      // Browser performance budgets (Lighthouse) — kept separate from the k6 API budget.
      browser: z
        .object({
          enabled: z.boolean().default(false),
          routes: z.array(z.object({ pathPrefix: z.string(), urlPattern: z.string() })).default([]),
          budgets: z
            .object({
              performanceScoreMin: z.number().default(0.9),
              lcpMs: z.number().default(2500),
              tbtMs: z.number().default(300),
              clsScore: z.number().default(0.1),
            })
            .default({}),
          warnMarginPercent: z.number().default(10),
          maxRoutesPerRun: z.number().int().positive().default(10),
        })
        .default({}),
    })
    .default({}),
  // Accessibility (axe-core) checks against the routes a PR changed.
  a11y: z
    .object({
      enabled: z.boolean().default(false),
      standard: z.enum(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).default('wcag21aa'),
      routes: z.array(z.object({ pathPrefix: z.string(), urlPattern: z.string() })).default([]),
      ignoreRules: z.array(z.string()).default([]),
      blockOnImpact: z
        .array(z.enum(['critical', 'serious', 'moderate', 'minor']))
        .default(['critical', 'serious']),
      warnOnImpact: z
        .array(z.enum(['critical', 'serious', 'moderate', 'minor']))
        .default(['moderate']),
      maxRoutesPerRun: z.number().int().positive().default(10),
    })
    .default({}),
  // Flaky-test intelligence: retry policy, root-cause classifier, trend gating.
  flake: z
    .object({
      retry: z
        .object({
          enabled: z.boolean().default(true),
          maxRetries: z.number().int().min(0).max(5).default(2),
          backoffMs: z.number().int().nonnegative().default(1000),
          backoffMultiplier: z.number().positive().default(2),
          retryOnlyKnownFlaky: z.boolean().default(false),
        })
        .default({}),
      classifier: z
        .object({
          enabled: z.boolean().default(true),
          minHistoryForClassification: z.number().int().nonnegative().default(3),
        })
        .default({}),
      gate: z
        .object({
          warnOnNewlyQuarantinedAbove: z.number().int().nonnegative().default(2),
        })
        .default({}),
    })
    .default({}),
  security: z
    .object({
      enabled: z.boolean().default(false),
      zapBaselineUrl: z.string().optional(),
    })
    .default({}),
  mobile: z
    .object({
      enabled: z.boolean().default(false),
      platforms: z.array(z.enum(['ios', 'android'])).default([]),
    })
    .default({}),
  learningContent: z
    .object({
      enabled: z.boolean().default(false),
      format: z.enum(['video', 'article', 'both']).default('both'),
      voiceover: z.boolean().default(true),
      publishDir: z.string().default('learning/'),
    })
    .default({}),
  // Cross-repo coverage sync: which repos hold this repo's tests/docs, and who depends on it.
  links: z
    .object({
      testRepos: z
        .array(
          z.object({
            repo: z.string(),
            pathPrefix: z.string().optional(),
            mapping: z.enum(['by-tag', 'by-path']).optional(),
          }),
        )
        .default([]),
      docRepos: z
        .array(z.object({ repo: z.string(), pathPrefix: z.string().optional() }))
        .default([]),
      dependents: z.array(z.string()).default([]),
    })
    .default({}),
  // Visual regression: opt-in, defaulted-off (like the other V2 features).
  visual: z
    .object({
      enabled: z.boolean().default(false),
      mode: z.enum(['pixel', 'ai']).default('pixel'),
      baselinesDir: z.string().default('tests/visual/baselines/'),
      viewports: z
        .array(z.object({ name: z.string(), width: z.number(), height: z.number() }))
        .default([
          { name: 'desktop', width: 1280, height: 720 },
          { name: 'mobile', width: 375, height: 667 },
        ]),
      themes: z.array(z.enum(['light', 'dark'])).default(['light']),
      noiseThreshold: z.number().default(0.001),
      antiAliasTolerance: z.number().default(0.1),
      gate: z.enum(['block', 'warn', 'off']).default('warn'),
      onNewBaseline: z.enum(['neutral', 'block']).default('neutral'),
      mask: z.array(z.string()).default([]),
      maxChecks: z.number().default(200),
    })
    .default({}),
  // Test-data management: declarative, namespaced seed/teardown per Test Set. Opt-in
  // (`enabled: false`) so zero-config repos are unaffected; `testcontainers` is additionally
  // gated because it requires a Docker-compatible daemon in CI. No secrets live here —
  // connection strings and tokens are read from the named env vars at runtime.
  fixtures: z
    .object({
      enabled: z.boolean().default(false),
      dir: z.string().default('tests/fixtures/'),
      defaultBackend: z.enum(['sql', 'api', 'testcontainers']).default('sql'),
      namespaceStrategy: z.enum(['per-run', 'per-shard']).default('per-run'),
      sql: z
        .object({
          connectionEnvVar: z.string().default('WARDEN_FIXTURES_DB_URL'),
        })
        .default({}),
      api: z
        .object({
          baseUrlEnvVar: z.string().default('WARDEN_FIXTURES_API_URL'),
          authHeaderEnvVar: z.string().default('WARDEN_FIXTURES_API_TOKEN'),
        })
        .default({}),
      testcontainers: z
        .object({
          enabled: z.boolean().default(false),
          reuseAcrossShards: z.boolean().default(false),
        })
        .default({}),
      teardown: z
        .object({
          onFailure: z.enum(['always', 'never', 'onSuccessOnly']).default('always'),
          timeoutMs: z.number().int().positive().default(30000),
        })
        .default({}),
    })
    .default({}),
  // API & contract testing: OpenAPI fuzzing (Schemathesis) + consumer-driven contract
  // verification (Pact Broker). Opt-in (`enabled: false`), same posture as `performance`/`security`.
  api: z
    .object({
      enabled: z.boolean().default(false),
      schemathesis: z
        .object({
          enabled: z.boolean().default(false),
          schemaUrl: z.string().optional(),
          checks: z
            .array(z.string())
            .default([
              'not_a_server_error',
              'response_schema_conformance',
              'status_code_conformance',
            ]),
          maxExamplesPerEndpoint: z.number().default(100),
        })
        .default({}),
      pact: z
        .object({
          enabled: z.boolean().default(false),
          role: z.enum(['provider', 'consumer']).default('provider'),
          providerName: z.string().optional(),
          brokerUrl: z.string().optional(),
          publishVerificationResults: z.boolean().default(true),
          // Pact consumer name -> the repo that owns it, for cross-repo drift advisories.
          consumerRepoMap: z.record(z.string(), z.string()).default({}),
        })
        .default({}),
    })
    .default({}),
  // Device-cloud grid & parallel sharding (additive; defaulted off, `local` needs no account).
  grid: GridConfigSchema,
  plugins: z.array(z.custom<QAPlatformPlugin>()).default([]),
});

export type WardenConfig = z.infer<typeof WardenConfigSchema>;
export type WardenConfigInput = z.input<typeof WardenConfigSchema>;

/** Validate a config object and fill defaults. Throws `ConfigError` on invalid input. */
export function defineConfig(config: WardenConfigInput = {}): WardenConfig {
  const parsed = WardenConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new ConfigError(`Invalid warden.config: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Load `warden.config.{ts,js,mjs,...}` from `cwd`, then validate + fill defaults. */
export async function loadConfig(cwd: string = process.cwd()): Promise<WardenConfig> {
  const { config } = await c12LoadConfig<WardenConfigInput>({ name: 'warden', cwd });
  const parsed = WardenConfigSchema.safeParse(config ?? {});
  if (!parsed.success) {
    throw new ConfigError(`Invalid warden.config: ${parsed.error.message}`);
  }
  return parsed.data;
}
