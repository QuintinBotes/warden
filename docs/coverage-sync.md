# Cross-Repo Coverage Sync

Keep your **tests and documentation in sync with your code** across repositories. When a pull request opens in one repo, the Warden GitHub App inspects the other repos you've linked to it — a shared test repo, a docs site, a dependent service — and opens a **draft pull request** suggesting the tests and docs to **add, update, or remove** to cover the change. A human reviews and merges every suggestion; Warden never merges on its own.

## How it works

1. A PR opens in `org/service-checkout`.
2. The Warden App reads the change and resolves the repos that repo links to (tests, docs, dependents).
3. It reads each linked repo's tests and docs and finds the gaps — new behavior with no test/doc, changed behavior a test/doc still describes the old way, or a deleted feature that leaves tests/docs behind.
4. It opens a **draft PR** in each external target with the suggested changes, adds doc suggestions to the source PR when docs live in the same repo, and posts a summary **check** on the source PR.
5. You review and merge.

## Setup

### 1. Install the App

Install the Warden GitHub App on your organization (self-hosted — see [Self-hosting](#self-hosting)). Grant it `contents: read/write`, `pull requests: write`, and `checks: write` on the repos you want it to watch.

### 2. Declare links per repo

Add a `links` block to each repo's `warden.config.ts` (or a central `org/.warden/links.yaml`):

```ts
export default {
  links: {
    // where this repo's tests live (one or more)
    testRepos: [{ repo: 'org/e2e-tests', pathPrefix: 'tests/', mapping: 'by-tag' }],

    // where this repo's docs live; `self` = this same repo (docs/, README, OpenAPI)
    docRepos: [
      { repo: 'self', pathPrefix: 'docs/' },
      { repo: 'org/developer-portal', pathPrefix: 'content/api/' },
    ],

    // repos whose tests exercise THIS repo (cross-service impact)
    dependents: ['org/service-billing'],
  },
};
```

That one model covers the common topologies:

| Topology | How to declare it |
|----------|-------------------|
| **Central test repo** (many services, one tests repo) | every service lists the same `testRepos: [{ repo: 'org/e2e-tests' }]` |
| **Paired test repo** (service + service-tests) | each service lists its own `testRepos` |
| **Docs in the code repo** | `docRepos: [{ repo: 'self', pathPrefix: 'docs/' }]` |
| **Separate docs site** | `docRepos: [{ repo: 'org/developer-portal' }]` |
| **Cross-service impact** | list the consumers in `dependents` |

### Config reference

| Field | Meaning |
|-------|---------|
| `links.testRepos[].repo` | `owner/repo` or `self` |
| `links.testRepos[].pathPrefix` | subdirectory holding the tests (e.g. `tests/`) |
| `links.testRepos[].mapping` | `by-tag` (match `@module` tags / requirement links) or `by-path` (mirror the directory structure) |
| `links.docRepos[].repo` | `owner/repo` or `self` |
| `links.docRepos[].pathPrefix` | subdirectory holding the docs |
| `links.dependents` | repos whose tests exercise this one |

## What you get

- A **draft PR** in each external target (`warden/sync-<repo>-pr-<n>`) containing the concrete `add` / `update` / `remove` changes — each with a reason tied to the change that motivated it. Removals appear as proposed deletions in the diff.
- **Review suggestions** on the source PR when the target is `self` (a README or OpenAPI tweak rides along with the code).
- A **check-run** on the source PR summarizing everything with links.

## Safety

- Every suggestion is reviewed and merged by a human — **nothing auto-merges**.
- Generated tests and docs are validated before they're committed; anything invalid is dropped and noted.
- Re-running on the same PR **updates the existing draft PR** rather than opening duplicates.
- Removals are proposed as diffs, never applied automatically.

## Self-hosting

The App is a small service. It runs from the project's [`deploy/`](../deploy/) compose alongside the dashboard and metrics stack. You'll need a registered GitHub App (App ID, private key, webhook secret) supplied as environment variables. See [Deployment & Self-Hosting](deployment.md).
