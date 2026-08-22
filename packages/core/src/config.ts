import { existsSync, promises as fs, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { QAPlatformPlugin } from './plugin';
import { ConfigError } from './errors';
import { GridConfigSchema } from './grid';
import { CujTier } from './cuj';
import { parseConfigModule } from './config-source';
import { GatesSchema } from './gate-policy';

/**
 * The single Warden configuration surface (`warden.config.ts`). Every field has a
 * documented default so a zero-config repo Just Works; `defineConfig` validates and
 * fills defaults, `loadConfig` reads the file from disk.
 *
 * The config file is *untrusted input*: it comes from the repository being tested, which on CI
 * is a pull request's head. `loadConfig` therefore reads it as data (see `config-source.ts`) and
 * never executes it, and refuses a config that would send model prompts to a non-loopback host.
 * Both restrictions lift under `WARDEN_TRUST_CONFIG=1`, which says "this checkout is mine".
 */

/** True for a syntactically valid `http:`/`https:` URL. Any other scheme is not an API base. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Every AI provider Warden can construct. Exported because a caller that *overrides* the
 * provider (the `warden agent --provider` flag) has to reject an unknown name rather than
 * hand a typo to `createProvider` and fail later, and it must reject against this list —
 * not a second copy of it that can fall a provider behind.
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama'] as const;

/** One of {@link AI_PROVIDERS}. */
export type AiProviderName = (typeof AI_PROVIDERS)[number];

const providerEnum = z.enum(AI_PROVIDERS);

/** Warden's three roles for the `enterprise` block; mirrors the `Role` type in `auth.ts`. */
const RoleSchema = z.enum(['viewer', 'maintainer', 'admin']);

export const WardenConfigSchema = z.object({
  ai: z
    .object({
      // Credentialed from this provider's own variable and no other: ANTHROPIC_API_KEY,
      // OPENAI_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY. `ollama` needs none. A missing key is a
      // hard error, never a stub — an agent report written without a model reads as a clean pass.
      provider: providerEnum.default('anthropic'),
      // A real, current model id. Override per repo; high-risk tiers may bump to Opus.
      model: z.string().default('claude-sonnet-5'),
      // Used only when the primary provider has no key; the supported way to run keyless is
      // `'ollama'`. A fallback with no credentials of its own fails the same way the primary does.
      fallbackProvider: providerEnum.optional(),
      ollama: z
        .object({
          // Where prompt text is sent, so it is validated rather than taken on trust: an http(s)
          // URL, never `file:`/`javascript:`/a bare hostname. A config read from the repo under
          // test may additionally only name a loopback host — see `assertPromptsStayLocal`.
          baseUrl: z
            .string()
            .refine(isHttpUrl, { message: 'must be an http:// or https:// URL' })
            .default('http://localhost:11434'),
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
      // Path prefixes whose changed files become *modules* — the unit the selective tier is
      // scoped to. A changed file under one of these contributes its first two path segments
      // as a module (`apps/checkout/page.tsx` → `apps/checkout`), which becomes the test tag
      // `<tagPrefix><module>`. The defaults describe a Next-style app; a repo laid out any
      // other way (`crates/`, `cmd/`, `internal/`, `libs/`, `services/`) must set this or the
      // selective tier has nothing to select and `warden analyze` says so.
      modulePaths: z
        .array(z.string().trim().min(1, 'scope.modulePaths entries must be non-empty prefixes'))
        .default(['apps/', 'src/features/']),
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
  // The merge-gate policy. Defined in `gate-policy.ts` alongside the one function that reads
  // it, so the schema and the gate can never describe different rules.
  gates: GatesSchema,
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
      // A retry round re-runs only the previous attempt's failures, selected by exact test title.
      // The titles are regex-escaped into the runner's `--grep`, so a title containing `[`, `(` or
      // `|` retries itself and nothing else.
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
  // Each repair is APPLIED to its spec file and the resulting file is what the draft PR commits;
  // a repair that no longer matches the file is named on the check-run and committed nowhere.
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
  // Enterprise readiness — auth/RBAC/audit/multi-tenancy for the hosted dashboard + GitHub App
  // (additive; every field defaults to today's behavior). `auth.mode: 'none'` keeps the
  // self-hosted OSS core fully auth-optional: no login, no RBAC enforcement, no audit records
  // kept. OIDC issuer/client secrets are DEPLOYMENT config (deploy/.env), never per-repo — they
  // are injected into `@warden/enterprise`'s factory, not read from this file. See
  // docs/proposals/2026-07-08-enterprise-readiness.md.
  enterprise: z
    .object({
      auth: z
        .object({
          // 'none' (self-hosted OSS default) | 'oidc' (hosted deployment opts in).
          mode: z.enum(['none', 'oidc']).default('none'),
          requiredRoleForGateOverride: RoleSchema.default('maintainer'),
          requiredRoleForSuggestionMerge: RoleSchema.default('maintainer'),
          requiredRoleForRoleChange: RoleSchema.default('admin'),
        })
        .default({}),
      audit: z
        .object({
          // auto-true when auth.mode !== 'none'; can be forced on independently.
          enabled: z.boolean().default(false),
          retentionDays: z.number().int().positive().default(400),
        })
        .default({}),
      dataHandling: z
        .object({
          piiScrubbing: z.boolean().default(true),
          executionHistoryRetentionDays: z.number().int().positive().default(400),
        })
        .default({}),
    })
    .default({}),
  // Test Impact Analysis (TIA) (additive; defaulted OFF so zero-config repos are unaffected).
  // When enabled with a coverage index present, a PR's default run is narrowed to exactly the
  // tests whose covered files intersect the diff. An uncovered changed file trips the
  // `onUncovered` safety net (`run-all` | `run-tagged` | `warn`) so a brand-new file is never
  // silently skipped; risk-based full-suite escalation still applies on top. See
  // docs/proposals/2026-07-09-tier-3-roadmap.md §1.
  impact: z
    .object({
      enabled: z.boolean().default(false),
      indexPath: z.string().default('warden-coverage-index.json'),
      onUncovered: z.enum(['run-all', 'run-tagged', 'warn']).default('run-all'),
    })
    .default({}),
  // Component testing tier (additive; defaulted OFF). Runs isolated component tests via
  // Playwright's component-test runner or Storybook's test-runner and gates on any failure,
  // same shape/posture as `performance`/`security`/`a11y`.
  component: z
    .object({
      enabled: z.boolean().default(false),
      runner: z.enum(['playwright-ct', 'storybook']).default('playwright-ct'),
      configPath: z.string().optional(),
      grep: z.string().optional(),
    })
    .default({}),
  // Load testing tier (additive; defaulted OFF). A separate, richer k6 tier — VUs, duration, and
  // multiple thresholds (p95/p99 latency + error rate) — distinct from the single API p95 budget
  // already covered by `performance.p95LatencyMs`. Same posture as `component`/`a11y`/`security`.
  load: z
    .object({
      enabled: z.boolean().default(false),
      script: z.string().default('load/script.js'),
      vus: z.number().default(10),
      durationSec: z.number().default(30),
      thresholds: z
        .object({
          p95Ms: z.number().default(800),
          p99Ms: z.number().default(1500),
          errorRate: z.number().default(0.01),
        })
        .default({}),
    })
    .default({}),
  // i18n content checks (additive; defaulted OFF). Pure — flattens locale JSON files under
  // `localesDir` and diffs each non-default locale against `defaultLocale`, reporting keys that
  // are present in the default locale but missing (or empty) elsewhere. Gaps rarely warrant
  // blocking a merge, so the gate defaults to `warn`; make it `block` for locales your team
  // treats as release-gating, or `off` to keep the check informational-only.
  i18n: z
    .object({
      enabled: z.boolean().default(false),
      localesDir: z.string().default('locales/'),
      defaultLocale: z.string().default('en'),
      ignoreKeys: z.array(z.string()).default([]),
      gate: z.enum(['block', 'warn', 'off']).default('warn'),
    })
    .default({}),
  // Hosted results service: public, token-gated run links (opt-in, self-hostable).
  resultsService: z
    .object({
      enabled: z.boolean().default(false),
      tokenTtlSec: z.number().int().positive().default(604800), // 7 days
      publicBaseUrl: z.string().default(''),
    })
    .default({}),
  // Plugin registry: manifest-based discovery/resolution of QAPlatformPlugins (opt-in).
  pluginRegistry: z
    .object({
      enabled: z.boolean().default(false),
      sources: z
        .array(z.object({ kind: z.enum(['dir', 'index']), location: z.string() }))
        .default([]),
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

/**
 * Config file extensions, in resolution order. The first one that exists wins; `.json` is parsed
 * as JSON, every other form is read as data by `parseConfigModule` and never executed.
 */
const CONFIG_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'] as const;

/** Hosts that cannot leave the machine. `.localhost` is reserved for loopback by RFC 6761. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/**
 * Refuses a config that would send model prompts off the machine.
 *
 * `ai.ollama.baseUrl` is the one config field that decides where prompt text goes — and prompt
 * text is the diff, seeded fixture values and live page text. A config file read from the
 * repository under test may therefore only name a loopback host: a one-line edit in a pull
 * request must not be able to redirect every prompt to an endpoint the attacker controls.
 * A remote Ollama in CI is still supported, from the environment (`WARDEN_OLLAMA_BASE_URL`),
 * which the repository cannot write.
 */
export function assertPromptsStayLocal(cfg: WardenConfig, source: string): void {
  const { hostname } = new URL(cfg.ai.ollama.baseUrl); // schema already proved it parses
  if (isLoopbackHost(hostname)) return;
  throw new ConfigError(
    `${source} points ai.ollama.baseUrl at ${hostname}, which is not this machine. Warden will ` +
      `not send model prompts (diffs, fixture values, page text) to a host named by a config ` +
      `file it read from the repository under test. Set WARDEN_OLLAMA_BASE_URL in the ` +
      `environment for a remote Ollama, or WARDEN_TRUST_CONFIG=1 on a checkout you trust.`,
  );
}

/** Deep-merges `overlay` onto `base`; arrays and scalars replace rather than concatenate. */
function mergeConfigData(base: unknown, overlay: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = key in out ? mergeConfigData(out[key], value) : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads `<cwd>/<basename><ext>` for the first `ext` that exists, as data. */
async function readConfigData(
  cwd: string,
  basename: string,
): Promise<{ file: string; data: unknown } | undefined> {
  for (const ext of CONFIG_EXTENSIONS) {
    const file = path.join(cwd, basename + ext);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf-8');
    } catch {
      continue;
    }
    if (ext === '.json') {
      try {
        return { file, data: JSON.parse(raw) };
      } catch (err) {
        throw new ConfigError(`${basename}${ext} is not valid JSON: ${(err as Error).message}`);
      }
    }
    return { file, data: parseConfigModule(raw, basename + ext) };
  }
  return undefined;
}

/** A config together with where it came from — see {@link loadConfigWithSource}. */
export interface LoadedConfig {
  /** The validated config, every default filled. Identical whether or not a file was found. */
  config: WardenConfig;
  /** Absolute path of the file the config was read from, or `null` when none was found. */
  sourcePath: string | null;
  /**
   * Whether a config source was actually found. `false` means every value below is a built-in
   * default that this repository never chose, which is not something a caller may present as
   * a configured verdict.
   */
  configured: boolean;
}

/** Resolve a config-file candidate to an existing file, or `null`. */
function existingFile(candidate: string): string | null {
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;
}

/** Options for {@link loadConfig}. */
export interface LoadConfigOptions {
  /**
   * Evaluate `warden.config.ts` as code (via c12/jiti) instead of reading it as data, and allow
   * it to name a remote AI endpoint. Only ever true for a checkout whose contents you vouch for
   * — never for a pull request's head. Defaults to `WARDEN_TRUST_CONFIG=1` in the environment.
   */
  trust?: boolean;
}

/**
 * Load `warden.config.{ts,mts,cts,js,mjs,cjs,json}` from `cwd` (with `warden.config.local.*`
 * merged on top when present), then validate + fill defaults.
 *
 * **The file is read, not run.** See `config-source.ts` for why, and for the grammar a config
 * has to stay inside. A config using anything beyond literal data throws `ConfigError` naming
 * the line rather than being partially understood.
 */
export async function loadConfig(
  cwd: string = process.cwd(),
  opts: LoadConfigOptions = {},
): Promise<WardenConfig> {
  return (await loadConfigWithSource(cwd, opts)).config;
}

/**
 * Load the config as {@link loadConfig} does, and report which file it came from.
 *
 * An absent config and a present-but-empty one produce byte-identical values, because every
 * field has a default. Only `configured` tells them apart, and callers that report a verdict —
 * a risk score, a tier selection, a merge-gate comment — have to say which one they were given
 * rather than presenting the defaults as this repository's own settings.
 */
export async function loadConfigWithSource(
  cwd: string = process.cwd(),
  opts: LoadConfigOptions = {},
): Promise<LoadedConfig> {
  const trusted = opts.trust ?? process.env.WARDEN_TRUST_CONFIG === '1';

  let raw: unknown;
  let source = 'warden.config';
  let sourcePath: string | null = null;
  if (trusted) {
    // Opt-in only: c12 hands the file to jiti, which transpiles and executes it.
    const { loadConfig: c12LoadConfig } = await import('c12');
    const loaded = await c12LoadConfig<WardenConfigInput>({ name: 'warden', cwd });
    raw = loaded.config;
    // c12 replaces `configFile` with the resolved absolute path when it finds one and otherwise
    // leaves it at the bare lookup name, so "absolute and still on disk" is the signal.
    const file = loaded.configFile;
    if (file && path.isAbsolute(file)) sourcePath = existingFile(file);
  } else {
    const found = await readConfigData(cwd, 'warden.config');
    const local = await readConfigData(cwd, 'warden.config.local');
    if (found) {
      source = path.basename(found.file);
      sourcePath = found.file;
    }
    if (local) {
      source = path.basename(local.file);
      sourcePath = local.file;
    }
    raw = found && local ? mergeConfigData(found.data, local.data) : (local ?? found)?.data;
  }

  const parsed = WardenConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ConfigError(`Invalid warden.config: ${parsed.error.message}`);
  }

  // The environment belongs to whoever runs Warden, not to the repository being tested, so an
  // endpoint set there overrides the file and is taken at its word.
  const envBaseUrl = process.env.WARDEN_OLLAMA_BASE_URL;
  if (envBaseUrl) {
    if (!isHttpUrl(envBaseUrl)) {
      throw new ConfigError(
        `WARDEN_OLLAMA_BASE_URL is not an http:// or https:// URL: ${envBaseUrl}`,
      );
    }
    parsed.data.ai.ollama.baseUrl = envBaseUrl;
  } else if (!trusted) {
    assertPromptsStayLocal(parsed.data, source);
  }

  return { config: parsed.data, sourcePath, configured: sourcePath !== null };
}
