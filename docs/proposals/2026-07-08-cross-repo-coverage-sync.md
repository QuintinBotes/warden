# Proposal: Cross-Repo Coverage Sync (tests & docs)

- **Status:** Draft (design approved, ready to plan)
- **Date:** 2026-07-08
- **Scope:** GitHub-only, cross-repository. Tests **and** documentation. Actions: add / update / remove.

## Summary

Today Warden reacts to a pull request by _running_ the tests that already exist. This proposal
closes the loop: when a PR opens in one GitHub repository, Warden also inspects the **other**
repositories linked to it — a shared test repo, a paired test repo, a docs site, or a dependent
service — and proposes the tests and documentation that should be **added, updated, or removed** to
keep them in sync with the change. Suggestions are delivered as a **draft pull request** in the
target repo (or as review suggestions when the target is the source repo itself), and a human
reviews and merges. Warden never auto-merges.

The feature is delivered as a hosted, org-installed **GitHub App** and reuses Warden's existing
analysis: the orchestrator's change-surface, the test-management coverage matrix, and the agent's
generative/healer reasoning.

## Motivation

In a microservice org, tests and docs for a service frequently live somewhere other than the
service's own repo — a central `e2e-tests` repository, a developer portal, an OpenAPI spec. When a
service changes, those other repositories silently drift: a new endpoint ships untested and
undocumented, a changed contract breaks a consumer's tests, a deleted feature leaves dead tests and
stale docs behind. Warden already understands what a diff changes and what is covered; extending
that understanding _across repositories_ turns "did the tests pass?" into "is the whole system —
tests and docs — still consistent with this change?"

## Goals

1. On a PR in repo A, resolve the linked repos (tests + docs + dependents) A declares, and analyze
   coverage/documentation gaps against A's change surface.
2. Produce concrete, reviewable recommendations of kind `test | doc` and action `add | update | remove`.
3. Deliver them as a **draft PR** in each external target, or as **review suggestions** on the source
   PR when the target is the source repo (`self`), plus a summary **check-run** on the source PR.
4. Be safe: generated changes are validated, removals are proposed-as-diff (never auto-applied),
   runs are idempotent, and nothing merges without a human.
5. Reuse Warden's existing packages; add the minimum new surface area.

## Non-Goals

- Non-GitHub hosts (GitLab/Bitbucket). GitHub only.
- Auto-merging any suggestion.
- Replacing the CI-embedded Action for in-repo runs; this App is additive and cross-repo.
- Semantic guarantees about _dependent-service_ impact beyond what the declared links + heuristics
  and the LLM can infer (see Risks).

## Architecture

Two new packages plus small, additive extensions to four existing ones.

### New

- **`@warden/github-app`** _(hosted service)_ — an org-installed GitHub App. A small webhook server
  (`@octokit/app` + `@octokit/webhooks`) that receives `pull_request` events, mints scoped
  installation tokens, runs the pipeline, and opens PRs / posts checks. Self-hostable; runs from the
  existing `deploy/` compose. Owns wiring only — no analysis logic of its own.
- **`@warden/coverage-sync`** — the cross-repo engine, as small isolated units (below). No GitHub or
  network calls of its own: every collaborator (file access, provider, publisher) is injected, so the
  whole engine is unit-testable without a live GitHub.

### Extended (additive, no breaking changes)

- **`@warden/core`** — new types: `RepoRef`, `RepoLinks`, `Recommendation`, `RecommendationKind`,
  `RecommendationAction`, `CoverageGaps`; additive `links` config block.
- **`@warden/orchestrator`** — accept a **fetched** diff (`DiffFile[]` from the API) in addition to
  local git, so the change surface can be computed for a remote PR.
- **`@warden/test-management`** — a file-access abstraction so the test inventory can be read over an
  injected reader (octokit contents API) rather than only the local filesystem.
- **`@warden/agent`** — a new `TestRecommender` / `DocRecommender` strategy (a `CoverageRecommender`)
  that composes the existing generative (add) and healer-style (update) reasoning plus removal
  detection.

### Units in `@warden/coverage-sync`

| Unit                  | Does                                                                                                                                       | Depends on                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `LinkResolver`        | `(sourceRepo, config) → RepoLinks` — resolves testRepos / docRepos / dependents from the source repo's `warden.config` or an org manifest. | core                                 |
| `TestInventoryReader` | `(RepoRef, FileAccess) → TestInventory` — YAML cases + a spec-file index for a target repo.                                                | test-management, injected FileAccess |
| `DocInventoryReader`  | `(RepoRef, FileAccess) → DocInventory` — markdown/MDX + OpenAPI/JSON-schema index for a target repo.                                       | injected FileAccess                  |
| `CoverageGapAnalyzer` | `(ChangeSurface, TestInventory, DocInventory) → CoverageGaps { uncovered, changed, orphaned }` for tests and docs.                         | orchestrator types                   |
| `CoverageRecommender` | `(CoverageGaps, DiffFile[], LLMProvider) → Recommendation[]` — the add/update/remove engine.                                               | agent, provider                      |
| `SuggestionPublisher` | `(Recommendation[], targets, sourcePr, GitHubAccess) → draft PRs + self-suggestions + a source-PR check`.                                  | injected GitHubAccess                |

`FileAccess` and `GitHubAccess` are minimal injected interfaces (contents read, branch/commit/PR
create, check-run create). The real implementations live in `@warden/github-app`; tests inject fakes.

## Configurable links

Additive `warden.config` block, read from the **source** repo's config or an org manifest repo
(`org/.warden/links.yaml`), whichever is present:

```ts
links: {
  // where this repo's tests live (one or more)
  testRepos: [{ repo: 'org/e2e-tests', pathPrefix: 'tests/', mapping: 'by-tag' }],

  // where this repo's docs live; `self` = the same repo (docs/, README, OpenAPI)
  docRepos: [
    { repo: 'self', pathPrefix: 'docs/' },
    { repo: 'org/developer-portal', pathPrefix: 'content/api/' },
  ],

  // repos whose tests exercise THIS repo (cross-service impact)
  dependents: ['org/service-billing'],
}
```

`mapping` tells the analyzer how to correlate a changed module to tests/docs: `by-tag` (match
`@module` tags / requirement links) or `by-path` (mirror the directory structure). This one model
covers the **central**, **paired**, and **cross-service** topologies by what you declare.

## Data flow

1. PR opens in `org/service-checkout` → `pull_request` webhook to the Warden App.
2. App authenticates as the installation and fetches the PR diff (`DiffFile[]`).
3. `@warden/orchestrator` computes the **change surface** (changed modules, routes, public signatures, risk).
4. `LinkResolver` reads `service-checkout`'s links → e.g. `org/e2e-tests`, `self:docs/`, `org/developer-portal`, and dependents.
5. For each target, `TestInventoryReader` / `DocInventoryReader` read the inventory via the contents API.
6. `CoverageGapAnalyzer` diffs the change surface against each inventory → `CoverageGaps` (uncovered / changed / orphaned), per kind.
7. `CoverageRecommender` (LLM) emits `Recommendation[]` — each `{ kind, action, targetRepo, path, reason, content? | patch? }`.
8. `SuggestionPublisher`:
   - external target (`org/e2e-tests`, `org/developer-portal`) → open/refresh a **draft PR** on branch `warden/sync-<sourceRepo>-pr-<n>` with the changes;
   - `self` target → attach **review suggestions** / a commit to the source PR's branch;
   - source PR → a **check-run** summarizing everything with links.
9. Humans review and merge each draft PR / accept the suggestions.

## Recommendation model

```ts
type RecommendationKind = 'test' | 'doc';
type RecommendationAction = 'add' | 'update' | 'remove';

interface Recommendation {
  kind: RecommendationKind;
  action: RecommendationAction;
  targetRepo: RepoRef; // may be `self`
  path: string; // file to add / edit / delete
  reason: string; // tied to the change that motivated it
  requirementIds?: string[]; // traceability
  content?: string; // full file for `add`
  patch?: string; // unified diff for `update` / `remove`
}
```

### How each action is decided

**Tests**

- `add` — a new user-facing surface in the diff (route, component, flow) with no covering test → the generative strategy writes a new, tagged spec.
- `update` — changed behavior where an existing test asserts the _old_ behavior → healer-style reasoning, run proactively against the diff (not a failure), proposes a minimal patch.
- `remove` — a deleted route/component/feature whose tests reference it (by tag / requirement link / imported symbol) → propose the deletion as a diff.

**Docs**

- `add` — a new endpoint / config option / public signature that no doc mentions → draft the doc/section (and, for an OpenAPI target, the schema entry).
- `update` — changed behavior/signature/config a doc still describes the old way → propose the edit.
- `remove` — a removed feature still documented → propose the deletion.

Every recommendation carries a `reason` and, where possible, the `requirementIds` it traces to, so a
reviewer sees _why_ each change is suggested.

## Safety & error handling

- **No links / nothing to do** → a quiet neutral check ("no linked repos configured" / "no gaps found").
- **Target unreadable** (permissions) → neutral check with a clear, actionable message; other targets still proceed.
- **Validation before commit** — generated specs must parse/typecheck and generated docs must render; invalid items are dropped and listed in the summary rather than committed.
- **Idempotency** — re-running on the same source PR updates the existing draft PR (same branch) instead of opening duplicates; the source-PR check is replaced, not stacked.
- **Removals are proposed, never applied** — they appear as deletions in a draft PR / as a flagged suggestion; a human approves.
- **Bounded** — large diffs and large inventories are capped; whatever is skipped is stated in the summary (no silent truncation).
- **Least privilege** — the App requests only `contents: read/write`, `pull_requests: write`, and `checks: write` on the installed repos.

## Testing

Fully hermetic, matching the rest of Warden:

- Each unit is unit-tested with fixtures and injected fakes — `FileAccess`, `GitHubAccess`, and
  `fakeProvider` from `@warden/core/testing`. No live GitHub, network, or LLM in unit tests.
- `LinkResolver`: config/manifest → resolved links (self, external, dependents).
- Inventory readers: fake file trees → inventory shapes.
- `CoverageGapAnalyzer`: (change surface + inventory) fixtures → expected gap classification, for both kinds.
- `CoverageRecommender`: gaps + `fakeProvider` → expected `Recommendation[]` (add/update/remove, test/doc), with generated specs asserted to be valid & tagged.
- `SuggestionPublisher`: recommendations → asserted draft-PR payload (branch, files, `draft: true`),
  self-suggestion payload, and source-PR check payload — against a mock octokit.
- `@warden/github-app`: a `pull_request` webhook fixture drives `run(deps)` with everything injected; asserts the end-to-end payloads. A real install is exercised only in a dogfood run.

## Rollout

1. Build `@warden/coverage-sync` + the `CoverageRecommender` strategy + core/orchestrator/test-management extensions (all hermetically testable, no App required).
2. Build `@warden/github-app` (webhook server + injected implementations of `FileAccess`/`GitHubAccess`).
3. Dogfood: install the App on this org against a demo service + a demo `e2e-tests` + `developer-portal`; confirm a real PR yields a draft test PR, doc suggestions, and a summary check.
4. Document install + `links` config in `docs/`.

## Risks & open items

- **Cross-service impact accuracy** — knowing which dependents a change truly affects is heuristic
  (declared `dependents` + contract/signature analysis + LLM inference). First version is conservative
  and clearly labels dependent-repo suggestions as lower-confidence.
- **Correlation without links** — `by-tag`/`by-path` mapping works best when teams already use
  requirement links / tags; without them the LLM bridges gaps but shouldn't be the only signal.
- **OpenAPI/doc formats** — first version targets Markdown/MDX and OpenAPI (JSON/YAML); other doc
  systems are future work.
- **Hosting** — the App is a running service (unlike the zero-infra Action). It ships in `deploy/`
  but self-hosting + the GitHub App registration are new operational steps.

```

```
