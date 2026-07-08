# Proposal: Notifications & Workflow Integrations

- Status: Draft (design proposal) · Date: 2026-07-08 · Relates to: warden-next-competitive-gaps.md §1.5

## Summary

Warden ships a `QAPlatformPlugin` extensibility API (`onPROpened` / `onTestExecutionStart` /
`onTestExecutionComplete` / `onBugFound` / `onGateDecision`) but today nothing in the codebase
calls those hooks, and no first-party plugin implements them. This proposal (1) wires the hooks
into the pipeline the docstring already promises — `@warden/orchestrator` gets a small
`firePluginHooks` dispatcher, called at the natural points in the CLI/Action pipeline — and (2)
ships a new `@warden/notifications` package with four first-party plugins — `slackPlugin`,
`teamsPlugin`, `webhookPlugin`, `pagerdutyPlugin` — that turn a `GateDecision` or
`ExploratoryFinding` into a compact, linkable message (verdict, top failures, replay link) posted
to the team's existing tools. It is additive config, additive core types, and mostly wiring on a
seam that already exists.

## Motivation

Per the gap analysis (§1.5): "Everyone" ships Slack/Teams/email/PagerDuty/webhooks — it's table
stakes, not a differentiator, but its absence is a first question evaluators ask and a real
adoption blocker: a gate that blocks a merge has to be able to ping the author where they already
work, and an on-call rotation expects a page, not a GitHub check nobody is watching. Warden already
has the right seam for this (`QAPlatformPlugin`) and the right data (`GateDecision`,
`ExploratoryFinding`, `TestExecution`) — it just has zero concrete notifiers and the hooks aren't
invoked anywhere, so today a team can _write_ a plugin but Warden never calls it.

## Goals

1. Actually fire `QAPlatformPlugin` hooks from the pipeline, in the order the interface already
   documents (`onPROpened` → `onTestExecutionStart` → `onTestExecutionComplete` → `onBugFound`* →
   `onGateDecision`), without changing any existing hook signature.
2. Ship four first-party, config-driven plugins: Slack (incoming webhook), Microsoft Teams
   (Adaptive Card via incoming webhook/Power Automate), a generic outbound `webhookPlugin` (for
   email relays, custom bots, ChatOps), and PagerDuty (Events API v2) for on-call paging.
3. Every message is compact and linkable: verdict (or bug severity), the top N failing tests / the
   bug's title, a link back to the PR, and — when the dashboard is enabled — a replay link.
4. A single plugin failure (bad webhook URL, network timeout, malformed secret) must never fail the
   test run or block other plugins.
5. No secrets in committed config — webhook URLs / routing keys are supplied the same way
   `@warden/integrations` supplies tokens: via injected deps (env vars at the call site), not the
   `warden.config.ts` value itself.

## Non-Goals

- Inbound ChatOps (approving/re-running from a Slack message) — outbound notification only.
- Email delivery (an SMTP/SES sender) — `webhookPlugin` can point at any email-relay webhook (e.g.
  Zapier, a serverless mail function); a dedicated `emailPlugin` is future work if demand shows up.
- A notification-preferences UI — config-only in V1; a dashboard settings page is a later rollout
  phase (see Rollout).
- Changing the `QAPlatformPlugin` hook signatures — they stay exactly as shipped; this proposal
  works within them.

## Architecture

One new package, plus a small additive dispatcher in the existing orchestrator and additive types
in `@warden/core`. No existing type or hook signature changes.

### Why the hooks alone aren't enough

`onGateDecision?: (decision: GateDecision) => Promise<void>` only carries `{ decision, reason }` —
no PR URL, no failing-test list, no execution id. Widening that signature would break every
existing plugin author, so instead each notification plugin is **stateful across one pipeline
run**: it also implements `onPROpened` and `onTestExecutionComplete` purely to _cache_ context
(the PR, the execution + its worst failures), and only _sends_ on `onBugFound` / `onGateDecision`,
composing the outbound message from the cached context plus that hook's payload. This is why the
feature is "mostly wiring" — every piece of data needed already flows through the existing hooks in
the existing order; nothing new needs to be threaded through the pipeline.

### New in `@warden/core` (additive)

`packages/core/src/plugin.ts` gains one new exported type — no changes to `QAPlatformPlugin` or
any existing interface:

```ts
/** One firing of a QAPlatformPlugin lifecycle hook, as dispatched by the orchestrator.
 *  A discriminated union so `firePluginHooks` can route to the right optional method
 *  on every configured plugin without the caller needing per-hook boilerplate. */
export type PluginHookEvent =
  | { hook: 'onPROpened'; pr: PullRequest }
  | { hook: 'onTestExecutionStart'; execution: TestExecution }
  | { hook: 'onTestExecutionComplete'; execution: TestExecution; results: TestResult[] }
  | { hook: 'onBugFound'; bug: ExploratoryFinding }
  | { hook: 'onGateDecision'; decision: GateDecision };
```

### Extended: `@warden/orchestrator` (additive, new file)

`packages/orchestrator/src/fire-plugin-hooks.ts` — the dispatcher promised by the `QAPlatformPlugin`
docstring ("Lifecycle hooks fired by the orchestrator"), added alongside the existing
`dispatchAgents` / `evaluateExitCriteria` units:

```ts
export interface PluginHookOutcome {
  plugin: string;
  hook: PluginHookEvent['hook'];
  ok: boolean;
  error?: string;
}

/** Invokes the matching optional hook on every plugin for one `PluginHookEvent`, in parallel.
 *  A plugin that has no handler for this hook, throws, or rejects never affects its siblings
 *  or the caller — failures are captured and returned, not thrown, so a bad Slack webhook
 *  can never fail the test run or block the merge gate. */
export function firePluginHooks(
  plugins: QAPlatformPlugin[],
  event: PluginHookEvent,
): Promise<PluginHookOutcome[]>;
```

Call sites (existing files, additive calls only):

- `packages/cli/src/run-run.ts` — after building `execution`, call `firePluginHooks(cfg.plugins, {
hook: 'onTestExecutionComplete', execution, results: execution.results })`; after computing the
  gate (via `computeGateDecision` from `@warden/reporter`, already imported by the reporter path),
  call it again with `{ hook: 'onGateDecision', decision: gate }`.
- `packages/cli/src/run-agent.ts` — for each `ExploratoryFinding` in the strategy's
  `AgentOutput.findings`, call `firePluginHooks(cfg.plugins, { hook: 'onBugFound', bug: finding })`.
- The GitHub composite action (`@warden/github-action`) calls `{ hook: 'onPROpened', pr }` once at
  startup, from the same PR payload it already threads into `ReportContext`.

### New: `@warden/notifications`

No network or GitHub calls of its own — every collaborator (the HTTP call, the clock) is injected,
so the whole package is unit-testable without a live Slack/Teams/PagerDuty endpoint.

| Unit                             | Does                                                                                                                                                                                                                                            | Depends on                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `message-builder.ts`             | `buildGateMessage(decision, ctx) → NotificationMessage` and `buildBugMessage(bug, ctx) → NotificationMessage` — pure functions turning a `GateDecision`/`ExploratoryFinding` plus cached `NotificationContext` into one channel-agnostic shape. | core types only                  |
| `notification-plugin.ts`         | `createNotificationPlugin(name, sender, filter) → QAPlatformPlugin` — the one stateful wrapper (caches PR + execution across the run, filters by severity/verdict, calls `sender.send`) that every channel below reuses.                        | message-builder, `ChannelSender` |
| `channels/slack-sender.ts`       | `ChannelSender` — renders Slack Block Kit, POSTs to an incoming webhook.                                                                                                                                                                        | injected `FetchLike`             |
| `channels/teams-sender.ts`       | `ChannelSender` — renders a Teams/Power-Automate Adaptive Card.                                                                                                                                                                                 | injected `FetchLike`             |
| `channels/webhook-sender.ts`     | `ChannelSender` — POSTs the plain `NotificationMessage` JSON, HMAC-SHA256-signed if a secret is configured.                                                                                                                                     | injected `FetchLike`             |
| `channels/pagerduty-sender.ts`   | `ChannelSender` — POSTs a PagerDuty Events API v2 `trigger` event, `dedup_key` derived from PR + hook so repeated gate decisions on the same PR update one incident instead of paging twice.                                                    | injected `FetchLike`             |
| `create-notification-plugins.ts` | `createNotificationPlugins(cfg, deps) → QAPlatformPlugin[]` — selects and constructs the enabled channels from `cfg.notifications`, same factory pattern as `createIntegration`/`createReporters`.                                              | core config, all of the above    |
| `fetch-like.ts`                  | Minimal injected `FetchLike` (mirrors `@warden/integrations`'s seam; each package owns its own minimal collaborator type by convention).                                                                                                        | —                                |

```ts
// message-builder.ts
export interface NotificationContext {
  pr?: PullRequest;
  topFailures?: { testCaseId: string; errorMessage?: string }[]; // worst N, from the cached execution
  dashboardExecutionUrl?: string; // built from cfg.notifications.dashboardBaseUrl + execution.id, when known
}

export interface NotificationMessage {
  event: 'gate_decision' | 'bug_found';
  title: string; // e.g. "⛔ BLOCK — PR #482: checkout redesign"
  summary: string; // the GateDecision.reason / the bug's expected-vs-actual, one line
  severity: 'info' | 'warning' | 'critical';
  details: string[]; // top-N failing test ids, or the bug's repro steps (capped)
  links: { prUrl?: string; dashboardExecutionUrl?: string };
  at: Date;
}

// channels/*.ts
export interface ChannelSender {
  name: 'slack' | 'teams' | 'webhook' | 'pagerduty';
  send(message: NotificationMessage): Promise<void>;
}
```

`notification-plugin.ts`'s wrapper is the only piece of stateful logic in the package; the four
channel senders are pure "render + POST" and every other unit above is a pure function — so nearly
all of `@warden/notifications` is trivially unit-testable.

## Configuration

Additive `notifications` block on `WardenConfigSchema`. All channels default `enabled: false`; no
behavior change for existing repos.

```ts
notifications: {
  slack: {
    enabled: false,
    notifyOn: ['BLOCK', 'WARN'],               // GateDecision.decision values that fire a message
    bugSeverity: ['CRITICAL', 'HIGH'],          // ExploratoryFinding.severity values that fire one
  },
  teams: {
    enabled: false,
    notifyOn: ['BLOCK', 'WARN'],
    bugSeverity: ['CRITICAL', 'HIGH'],
  },
  webhook: {
    enabled: false,
    notifyOn: ['BLOCK', 'WARN', 'PASS'],        // e.g. a ChatOps bot that wants every verdict
    bugSeverity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
  },
  pagerduty: {
    enabled: false,
    pageOn: ['BLOCK'],                          // deliberately narrower than notifyOn — paging is expensive
    bugSeverity: ['CRITICAL'],
  },
  dashboardBaseUrl: undefined,                  // e.g. "https://qa.example.com" — enables replay links
}
```

Secrets follow the existing `@warden/integrations` convention (`CreateIntegrationDeps.token`) —
they are **not** config values. `createNotificationPlugins(cfg, deps)` takes them as injected deps,
which the CLI/Action populate from environment variables:

```ts
export interface CreateNotificationPluginsDeps {
  fetchImpl?: FetchLike; // defaults to global fetch; tests always inject a fake
  slackWebhookUrl?: string; // env: WARDEN_SLACK_WEBHOOK_URL
  teamsWebhookUrl?: string; // env: WARDEN_TEAMS_WEBHOOK_URL
  webhookUrl?: string; // env: WARDEN_WEBHOOK_URL
  webhookSecret?: string; // env: WARDEN_WEBHOOK_SECRET (HMAC-signs the payload)
  pagerdutyRoutingKey?: string; // env: WARDEN_PAGERDUTY_ROUTING_KEY
  now?: () => Date; // injected clock for deterministic tests
}
```

`createNotificationPlugins` throws a `WardenError('NOTIFICATION_MISSING_CONFIG')` if a channel is
`enabled` but its required dep (webhook URL / routing key) is missing — the same fail-fast pattern
`createIntegration` already uses for a missing token.

## Data flow

1. PR opens → the Action builds a `PullRequest` from the event payload and calls
   `firePluginHooks(cfg.plugins, { hook: 'onPROpened', pr })`. Each notification plugin instance
   caches `pr` for the rest of the run.
2. `@warden/orchestrator` computes the change surface, selects tiers, and `dispatchAgents` runs as
   today — unchanged.
3. `runRun` executes the selected tier(s), builds `execution: TestExecution`, and calls
   `firePluginHooks(cfg.plugins, { hook: 'onTestExecutionComplete', execution, results:
execution.results })`. Each plugin caches the execution and derives `topFailures` (the worst N
   `FAIL`/`FLAKY` results) — no message is sent yet.
4. If the `aiExploratory` tier ran, for each `ExploratoryFinding` at or above the plugin's configured
   `bugSeverity`, `firePluginHooks(cfg.plugins, { hook: 'onBugFound', bug: finding })` fires.
   `buildBugMessage` composes title/summary/links from the finding + the cached PR, `notification-
plugin.ts` checks the severity filter, and the channel's `send` posts it.
5. `evaluateExitCriteria` computes the authoritative `GateDecision`; `firePluginHooks(cfg.plugins, {
hook: 'onGateDecision', decision })` fires. `buildGateMessage` composes the verdict, the cached
   `topFailures`, the PR link, and — if `cfg.notifications.dashboardBaseUrl` and `cfg.dashboard.
enabled` are set — a replay link to the execution in the dashboard. `notifyOn` (or, for
   PagerDuty, `pageOn`) filters whether this channel sends at all.
6. Existing reporters (CTRF, GitHub Job Summary, PR comment, check-run annotations) still run
   independently over the same `execution`/`decision` — notifications are a parallel, chat/paging
   surface, never a replacement for the GitHub-native report.
7. Each `send` call's outcome (ok / error, latency) is captured in the `PluginHookOutcome[]`
   `firePluginHooks` returns; the CLI logs failures via `@warden/core`'s logger and, when
   `cfg.observability.enabled`, pushes a `warden_notification_delivery_total{channel,event,ok}`
   counter through the existing `MetricsEmitter` seam. A failed notification never changes the
   `GateDecision` or the process exit code.

## Safety & error handling

- **Never blocks the pipeline** — `firePluginHooks` catches per-plugin, per-hook; a thrown error or
  a rejected `send` becomes a `PluginHookOutcome { ok: false, error }`, not an exception the caller
  has to handle. The test run's exit code depends only on the gate, never on notification delivery.
- **Bounded, capped messages** — `details` is capped at 5 items (top failures / repro steps) with a
  "+N more, see the PR" trailer, so Slack (40 KB) / Teams / PagerDuty payload limits are never hit.
- **Timeouts** — every channel `send` uses `AbortSignal.timeout(5000)` on the injected fetch so a
  hung webhook endpoint can't hang a CI job.
- **Least alerting by default** — `pagerduty.pageOn` defaults to `['BLOCK']` only (not `WARN`),
  deliberately narrower than Slack/Teams, to avoid on-call alert fatigue from a chat-oriented signal.
- **Idempotent paging** — the PagerDuty sender derives `dedup_key` from `${pr.number}:${event}` so
  re-runs of the same PR update one incident instead of opening duplicates.
- **No new data exposure** — messages carry exactly the same finding/result content already posted
  to the GitHub PR comment (`@warden/reporter`'s `renderPrReport`); nothing sent to Slack/Teams/
  PagerDuty is data the team hasn't already put in the PR itself. Teams routing to third-party SaaS
  should still review their own data-handling policy for that destination.
- **Fail fast on misconfiguration** — an `enabled: true` channel missing its required secret/URL
  throws at `createNotificationPlugins` construction time (before any test runs), not silently at
  send time.
- **Webhook integrity** — `webhookPlugin` HMAC-SHA256-signs the payload (header `X-Warden-Signature`)
  whenever `webhookSecret` is supplied, so a receiver can verify authenticity.

## Testing

Fully hermetic, matching the rest of Warden — no live Slack/Teams/PagerDuty/webhook endpoint and no
live pipeline in any unit test:

- `message-builder.ts`: fixture `GateDecision`/`ExploratoryFinding` + `NotificationContext` →
  asserted `NotificationMessage` shape, including the 5-item cap and the "+N more" trailer, and that
  `links.dashboardExecutionUrl` is omitted when `dashboardBaseUrl` wasn't configured.
- `notification-plugin.ts`: a fake `ChannelSender` (`recordingSender()`, records every `send` call)
  drives the wrapper through `onPROpened` → `onTestExecutionComplete` → `onBugFound` →
  `onGateDecision` and asserts (a) the cached PR/topFailures reach the final message, (b) the
  severity/verdict filters correctly suppress a send, (c) a `send` rejection is swallowed and
  surfaced as a `PluginHookOutcome`, not thrown.
- Each channel sender (`slack-sender.test.ts`, `teams-sender.test.ts`, `webhook-sender.test.ts`,
  `pagerduty-sender.test.ts`): a fake `FetchLike` capturing the request → asserts the correct URL,
  headers (including the HMAC signature for `webhookPlugin` when a secret is set), and payload shape
  (Slack Block Kit blocks, Teams Adaptive Card schema, PagerDuty `routing_key`/`event_action`/
  `dedup_key`).
- `create-notification-plugins.ts`: `cfg.notifications` combinations (all off / one on / all on;
  missing-secret-while-enabled) → asserted returned plugin list and the fail-fast `WardenError` for
  the missing-secret case.
- `firePluginHooks` (orchestrator): an array of fake `QAPlatformPlugin`s — one that implements the
  hook, one that doesn't, one whose handler throws — → asserts every plugin gets its matching hook
  called with the exact event payload, the throwing plugin doesn't stop its siblings, and the
  returned `PluginHookOutcome[]` correctly marks `ok: false` for the failure.
- CLI wiring (`run-run.test.ts`, `run-agent.test.ts`): inject a fake plugin via `cfg.plugins` and
  assert `onTestExecutionComplete` / `onGateDecision` / `onBugFound` fire with the right execution/
  decision/finding, using the existing `fixtureExecution` / `fakeProvider` fixtures from
  `@warden/core/testing`.

## Rollout

1. **Wire the seam** — add `PluginHookEvent` to `@warden/core`, `firePluginHooks` to
   `@warden/orchestrator`, and the three call sites (`run-run.ts`, `run-agent.ts`, the GitHub
   Action's PR-open step). No channels yet; verify with a fake plugin end-to-end.
2. **Ship `@warden/notifications`** with `slackPlugin` and `webhookPlugin` (the two most commonly
   requested) behind `cfg.notifications`, fully hermetically tested.
3. **Add `teamsPlugin` and `pagerdutyPlugin`.**
4. **Document + expose** — `warden init` scaffolds a commented-out `notifications` block; the
   GitHub Action's `action.yml` gains `slack-webhook-url` / `teams-webhook-url` / `webhook-url` /
   `webhook-secret` / `pagerduty-routing-key` inputs mapped straight to
   `CreateNotificationPluginsDeps`; `docs/configuration.md` documents the block and the env-var
   convention for secrets.
5. **(Later)** a dashboard settings page (`apps/dashboard` + `@warden/dashboard-api`) to manage
   channels without editing `warden.config.ts`, once there's a persisted config store to back it.

## Risks & open items

- **Stateful-plugin ordering** — the compact message depends on hooks firing in the documented
  order (`onPROpened` → `onTestExecutionComplete` → `onBugFound`/`onGateDecision`) from a single
  call site per run. A plugin author calling hooks out of order (or reusing one plugin instance
  across concurrent PRs) would get stale or missing context; this should be called out explicitly
  in `plugin.ts`'s docstring once `firePluginHooks` ships, and `createNotificationPlugins` should
  document that it returns a **fresh** plugin instance per invocation (never share one across runs).
- **PagerDuty default is a product judgment call** (`pageOn: ['BLOCK']` only) — worth revisiting
  once real usage/alert-fatigue data exists.
- **Teams "incoming webhook" deprecation risk** — Microsoft has been narrowing Office 365 connector
  webhooks in favor of Power Automate workflows; `teams-sender.ts` should target whichever URL shape
  is current at build time and note the migration path in its own doc comment.
- **No delivery retries beyond one attempt in V1** — a transient webhook failure is logged and
  counted, not retried; if delivery reliability turns out to matter, a small bounded retry (2
  attempts, short backoff) can be added inside each `ChannelSender` without changing the public
  shape.
