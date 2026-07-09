# Tier-3 Capabilities

Warden's Tier-3 features sharpen **selection precision**, add **extra test tiers**, and grow the
**ecosystem**. Every one is opt-in and **defaulted off** — enabling a block in `warden.config.ts`
is all it takes; nothing here changes an existing pipeline until you ask for it.

| Capability                                        | What it does                               | Turn it on with                                |
| ------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| [Test impact analysis](#test-impact-analysis)     | Run only the tests a diff actually affects | `impact.enabled` + `warden run --impact-index` |
| [Component testing](#component-testing)           | A component/Storybook test tier            | `component.enabled`                            |
| [Load testing](#load-testing)                     | A k6 load tier with latency/error budgets  | `load.enabled`                                 |
| [i18n checks](#i18n-content-checks)               | Flag missing/empty translation keys        | `i18n.enabled`                                 |
| [Hosted results service](#hosted-results-service) | Public, token-gated run links              | `resultsService.enabled`                       |
| [Plugin registry](#plugin-registry)               | Discover + resolve plugins from manifests  | `pluginRegistry.enabled`                       |

---

## Test impact analysis

Selecting tests by changed module + risk is coarse. With a **coverage index** — a map of each test
to the source files it exercised on a prior run — Warden runs _exactly_ the tests a diff touches,
with a safety net so brand-new/uncovered files are never silently skipped.

```ts
export default {
  impact: {
    enabled: true,
    indexPath: 'warden-coverage-index.json',
    // What to do for changed files no test covers:
    // 'run-all' (default, safest) · 'run-tagged' · 'warn'
    onUncovered: 'run-all',
  },
};
```

**The index** is JSON. Warden accepts its native shape or a plain istanbul/v8-style map:

```json
[
  {
    "testId": "checkout applies coupon",
    "testName": "checkout applies coupon",
    "files": ["apps/checkout/coupon.ts", "apps/checkout/cart.ts"]
  },
  { "testId": "sign-in", "testName": "sign-in", "files": ["apps/auth/login.ts"] }
]
```

Produce it from a normal coverage run (or a Warden run), commit or cache it, then narrow a PR run:

```bash
warden run --impact-index warden-coverage-index.json --base "$BASE_SHA" --head "$HEAD_SHA"
```

Only the impacted tests run. A high-risk change still escalates to the full suite — impact analysis
narrows the _default_, it never overrides the risk gate.

---

## Component testing

Runs component-level tests (Playwright Component Testing or the Storybook test-runner) as their own
tier, emitting CTRF into the same gate as every other tier.

```ts
export default {
  component: {
    enabled: true,
    runner: 'playwright-ct', // or 'storybook'
    configPath: 'playwright-ct.config.ts', // optional
    grep: '@component', // optional filter
  },
};
```

A failing component test blocks the gate exactly like a failing e2e test.

## Load testing

A first-class [k6](https://k6.io) load tier with explicit budgets. Point it at a k6 script and set
your thresholds; a breach blocks the gate.

```ts
export default {
  load: {
    enabled: true,
    script: 'load/script.js',
    vus: 10,
    durationSec: 30,
    thresholds: { p95Ms: 800, p99Ms: 1500, errorRate: 0.01 },
  },
};
```

One CTRF test is emitted per threshold, so the report shows exactly which budget breached. (This is
separate from the k6 **API-latency** budget under `performance` — this tier is about sustained load.)

## i18n content checks

A pure check that flags translation keys present in your default locale but **missing or empty** in
the others — no browser, no network.

```ts
export default {
  i18n: {
    enabled: true,
    localesDir: 'locales/',
    defaultLocale: 'en',
    ignoreKeys: ['debug.internal'],
    gate: 'warn', // 'block' | 'warn' (default) | 'off'
  },
};
```

Each `(locale, missing-key)` becomes a CTRF finding. It warns by default — i18n gaps rarely need to
block a merge — but set `gate: 'block'` to enforce complete translations.

> **Accessibility & performance budgets** (the axe / Lighthouse tiers) are configured under `a11y`
> and `performance.browser`. They're route-scoped, so `warden run` needs a deployment to hit:
> `warden run --base-url https://preview.example.com --base "$BASE_SHA" --head "$HEAD_SHA"`. The
> GitHub Action exposes this as the `base-url` input.

---

## Hosted results service

Share a run's results with anyone via a **signed, expiring public link** — no account needed. The
service serves a **redacted** view (status + timings, never error stacks) over your dashboard data;
the token is the credential.

```ts
export default {
  resultsService: {
    enabled: true,
    tokenTtlSec: 604800, // link lifetime — 7 days
    publicBaseUrl: 'https://qa.example.com',
  },
};
```

Run the service (it never listens on import — a thin entry binds the port). Secrets come from the
environment, never config:

```bash
WARDEN_RESULTS_ENABLED=true \
WARDEN_RESULTS_SECRET="$(openssl rand -hex 32)" \
WARDEN_PUBLIC_BASE_URL=https://qa.example.com \
WARDEN_RESULTS_PORT=3003 \
WARDEN_DASHBOARD_API_MODULE=./dashboard-api.mjs \
node packages/results-service/server-entry.mjs
```

| Route                      | Purpose                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `GET /api/runs`            | list recent runs                                                  |
| `GET /api/runs/:id`        | one run                                                           |
| `POST /api/runs/:id/share` | mint a share link → `{ url }`                                     |
| `GET /share/:token`        | the public, redacted run view (410 when expired, 404 if tampered) |

Rotate `WARDEN_RESULTS_SECRET` to invalidate every outstanding link at once.

## Plugin registry

Turn `QAPlatformPlugin`s into a discoverable ecosystem. A **manifest** describes a plugin so it can
be listed, searched, and dynamically resolved — instead of hard-coding it into your config.

```jsonc
// plugins/acme-slack.manifest.json
{
  "name": "@acme/warden-slack",
  "version": "1.2.0",
  "description": "Post the gate verdict to Slack",
  "entry": "@acme/warden-slack",
  "capabilities": ["onGateDecision", "onBugFound"],
  "tags": ["notifications", "slack"],
}
```

```ts
export default {
  pluginRegistry: {
    enabled: true,
    sources: [
      { kind: 'dir', location: 'plugins/' }, // a folder of *.manifest.json
      { kind: 'index', location: 'https://registry.example.com/warden-plugins.json' },
    ],
  },
};
```

Programmatically:

```ts
import { loadRegistry, resolvePlugin } from '@warden/plugin-registry';

const registry = await loadRegistry(cfg.pluginRegistry.sources, fileAccess);
const hits = registry.search({ capability: 'onGateDecision', tag: 'notifications' });
const plugin = await resolvePlugin(hits[0], (spec) => import(spec)); // → a QAPlatformPlugin
```

`resolvePlugin` accepts a default export, a named `plugin`, or a factory function; invalid manifests
are skipped during load (never fatal), and a later source wins on a name clash.

---

See [Configuration](configuration.md) for every option and its default, and the
[design proposals](proposals/) for the _why_ behind each capability.
