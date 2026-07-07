## What this changes

<!-- A short description of the change and why. Link any related issue: Closes #123 -->

## Type

- [ ] Bug fix
- [ ] Feature
- [ ] Docs
- [ ] Refactor / chore

## Checklist

- [ ] `pnpm -w build && pnpm -w test && pnpm -w typecheck && pnpm -w lint` all pass locally
- [ ] New behavior is covered by tests (written test-first where practical)
- [ ] Unit tests are hermetic — no real network, LLM API, browser, or GitHub calls
- [ ] Changes are scoped to as few packages as possible; shared types go in `@warden/core`
- [ ] Docs updated if behavior or configuration changed
- [ ] No secrets, keys, or `.env` files added

## Notes for reviewers

<!-- Anything that needs a closer look, tradeoffs made, or follow-ups deferred. -->

---

> A maintainer (code owner) review and approval is required before this PR can be merged. CI (build/test/typecheck/lint) and the Warden self-test must be green.
