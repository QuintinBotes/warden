import { z } from 'zod';
import { loadConfig as c12LoadConfig } from 'c12';
import type { QAPlatformPlugin } from './plugin';
import { ConfigError } from './errors';
import { GridConfigSchema } from './grid';
import { CujTier } from './cuj';

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
      // External test-management sync (additive). `source: 'none'` is a clean no-op, so every
      // existing config stays valid. Secrets (API tokens) are injected into the factory from the
      // environment — never read from this file. See docs/proposals/2026-07-08-test-management-sync.md.
      sync: z
        .object({
          source: z
            .enum(['none', 'testomatio', 'qase', 'testrail', 'xray', 'zephyr', 'allure-testops'])
            .default('none'),
          project: z.string().optional(),
          apiUrl: z.string().optional(),
          pullCatalog: z.boolean().default(true),
          registerProposed: z.boolean().default(true),
          pushResults: z.boolean().default(true),
          sourceCodeFirst: z.boolean().default(true),
        })
        .default({}),
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
  // Multi-SCM host selection (additive). Drives which `VcsProvider` adapter `@warden/vcs`
  // constructs for the reporting/gating/coverage-sync surfaces. Defaults preserve today's
  // GitHub-only behavior exactly (`provider: 'github'`). Tokens are NEVER stored here —
  // `createVcsProviderFromEnv` reads the host-specific CI secret at runtime. See
  // docs/proposals/2026-07-08-multi-scm.md.
  vcs: z
    .object({
      // Which host this repo is hosted on. Drives which VcsProvider adapter is constructed.
      provider: z.enum(['github', 'gitlab', 'bitbucket', 'azure-devops']).default('github'),
      // Override for self-hosted/on-prem instances (GHES, GitLab self-managed, Bitbucket
      // Server, Azure DevOps Server). Defaults to each host's public API base URL.
      baseUrl: z.string().optional(),
      // Azure DevOps REST api-version pin (e.g. '7.1'). Ignored by other hosts.
      apiVersion: z.string().optional(),
      // Azure DevOps project name (owner/org comes from the repo path). Ignored by other hosts.
      project: z.string().optional(),
    })
    .default({}),
  // Critical User Journey (CUJ) modeling (additive; defaulted off so zero-config repos are
  // unaffected). The CUJ gate only fires for journeys a change actually *touches*, so adopting
  // CUJs is incremental: a team can define one journey and gate only it. See
  // docs/proposals/2026-07-08-cuj-modeling.md.
  cuj: z
    .object({
      enabled: z.boolean().default(false),
      dir: z.string().default('.warden/cuj/'), // where Cuj YAML defs live (loaded like tests/cases/)
      gate: z
        .object({
          enabled: z.boolean().default(true), // the CUJ gate only runs when a CUJ is actually touched
          blockOnBroken: z.boolean().default(true), // any touched CUJ that is BROKEN blocks the merge
          blockTier1OnDegrade: z.boolean().default(true), // a tier-1 journey regressing (not just broken) blocks
          warnTier2OnDegrade: z.boolean().default(true), // a tier-2 regression warns
        })
        .default({}),
      signals: z
        .object({
          // fold non-functional signals into health when those tiers run
          a11y: z.boolean().default(false),
          perf: z.boolean().default(false),
          visual: z.boolean().default(false),
        })
        .default({}),
      exploratory: z
        .object({
          // feed the exploratory agent a touched CUJ at/above this tier
          missionBriefTier: CujTier.default('tier1'),
        })
        .default({}),
    })
    .default({}),
  // Proactive self-healing (additive; defaulted OFF). An optional pass that re-resolves the
  // role/label locators used by a PR's affected tests against the preview build and opens a
  // DRAFT healing PR for any that no longer resolve — before the tests go red. It never gates
  // (its check-run is always neutral) and never replaces the reasoning `HealerStrategy`.
  // Two-key activation: needs both `enabled: true` and a reachable `previewUrlTemplate`. See
  // docs/proposals/2026-07-08-proactive-self-healing.md.
  proactiveHealing: z
    .object({
      enabled: z.boolean().default(false),
      // Extra module-path patterns (beyond a non-empty affectedComponents) that count as UI change.
      uiPatterns: z.array(z.string()).default(['components/', 'pages/', 'app/']),
      // Where to reach the PR's live preview build; `{sha}` / `{pr}` are substituted at launch.
      previewUrlTemplate: z.string().optional(),
      // Only touch locators used by tests tagged for the affected modules — never the whole suite.
      scopeToAffectedTags: z.boolean().default(true),
      // Skip a locator whose repair confidence is below this bar; it's left for the reactive healer.
      minConfidence: z.enum(['low', 'medium', 'high']).default('medium'),
      // Cap on locators checked per run, to bound preview-session cost on large PRs.
      maxLocatorsPerRun: z.number().int().positive().default(200),
    })
    .default({}),
  // Production-traffic recording (additive; defaulted OFF — strictly opt-in). Captures real,
  // consenting, sampled user sessions, scrubs PII fail-closed BEFORE anything durable is written,
  // clusters them into ranked candidate journeys, and hands the high-value clusters to the reused
  // AiTestSynthesizer to propose tagged Playwright specs + candidate CUJs as a DRAFT PR. Nothing
  // captures unless `enabled: true`; nothing auto-merges. See
  // docs/proposals/2026-07-08-traffic-recording.md.
  traffic: z
    .object({
      enabled: z.boolean().default(false), // strictly opt-in; nothing captures unless true
      source: z.enum(['browser-sdk', 'reverse-proxy']).default('browser-sdk'),
      sampleRate: z.number().min(0).max(1).default(0.01), // fraction of consenting sessions captured
      consent: z
        .object({
          required: z.boolean().default(true), // capture requires an explicit consent signal
          cookieName: z.string().default('warden_traffic_opt_in'),
          honorDoNotTrack: z.boolean().default(true), // DNT / GPC suppresses capture regardless of cookie
        })
        .default({}),
      pii: z
        .object({
          redactionToken: z.string().default('[REDACTED]'),
          // Built-in rules (email, phone, PAN/luhn, SSN, JWT/bearer, uuid-in-url) always apply.
          extraRules: z
            .array(
              z.object({
                name: z.string(),
                pattern: z.instanceof(RegExp),
                applyTo: z.enum(['value', 'selectorName', 'url']),
              }),
            )
            .default([]),
          // Allowlist model: ONLY these selector-name labels pass through unredacted.
          selectorAllowlist: z
            .array(z.string())
            .default(['Search', 'Category', 'Sort by', 'Quantity']),
        })
        .default({}),
      retention: z
        .object({
          storeRawAfterScrub: z.boolean().default(false), // never persist unscrubbed capture
          scrubbedTtlDays: z.number().int().positive().default(30), // retention sweep of the store
        })
        .default({}),
      clustering: z
        .object({
          minSessions: z.number().int().nonnegative().default(5), // ignore clusters below this size
          topClusters: z.number().int().positive().default(20), // synthesize at most this many, by weight
          businessWeightByRoute: z.record(z.string(), z.number()).default({}), // e.g. { '/checkout/:id': 5 }
        })
        .default({}),
      synthesis: z
        .object({
          minClusterFrequency: z.number().int().nonnegative().default(10), // must recur this often to synthesize
          proposeCujs: z.boolean().default(true), // emit CandidateCUJ per cluster
          outDir: z.string().default('tests/e2e/traffic/'), // where synthesized specs land in the draft PR
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
