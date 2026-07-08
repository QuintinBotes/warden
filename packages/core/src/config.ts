import { z } from 'zod';
import { loadConfig as c12LoadConfig } from 'c12';
import type { QAPlatformPlugin } from './plugin';
import { ConfigError } from './errors';

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
      p95LatencyMs: z.number().default(500),
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
