# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's [security advisories](https://github.com/QuintinBotes/warden/security/advisories/new) ("Report a vulnerability"). If that is unavailable to you, contact the maintainer directly and wait for a response before disclosing.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal proof-of-concept if possible).
- Affected versions or commit.

You can expect an acknowledgement within a few days and a plan for a fix. Coordinated disclosure is appreciated — we will credit reporters who wish to be named.

## Supported versions

Warden is pre-1.0. Security fixes land on `main` and are released in the next tagged version. Pin the GitHub Action to a full version for reproducibility.

## Handling secrets

Warden never writes secrets to disk or logs. Two secrets are used, both read from the environment:

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | The AI engine. Store as a repository/organization secret. |
| `GITHUB_TOKEN` | PR comments and check runs. The built-in Actions token is sufficient. |

If you believe a secret has been exposed, rotate it immediately. The repository's `.gitignore` excludes `.env*`, key files, and local databases; do not force-add them.

## The repository under test is untrusted input

Warden runs against a pull request's head, in a job that holds `ANTHROPIC_API_KEY`. Everything
it reads out of that checkout is written by whoever opened the PR, so two things are true by
construction:

- **`warden.config.*` is parsed as data, never executed.** Handing the file to a transpiler
  would give any contributor code execution inside a job holding your key. The loader reads the
  exported literal and refuses calls, variable references, template substitutions and spreads,
  naming the line. `WARDEN_TRUST_CONFIG=1` restores the old evaluate-with-c12 behaviour and must
  only ever be set for a checkout you vouch for — never in a `pull_request`-triggered workflow.
- **A config file cannot redirect model prompts off the machine.** `ai.ollama.baseUrl` decides
  where prompt text — the diff, seeded fixture values, live page text — is sent, so from a config
  file it must be an `http(s)` URL naming a loopback host. A remote Ollama is configured with
  `WARDEN_OLLAMA_BASE_URL` in the environment, which the repository cannot write.

Neither restriction applies to `defineConfig` called programmatically in your own process: that
config is yours.

## Untrusted data in CI

Warden's workflows run on `pull_request`, against a branch anyone can write. GitHub expands
`${{ … }}` into a `run:` script as text before the shell parses it, so any expression carrying
pull-request data — most sharply `test_tags`, which `warden analyze` builds from the changed
files' own paths — must reach a command through an `env:` variable read as `"$VAR"`. The
workflows Warden scaffolds (`warden init`), ships (`ai-qa.example.yml`), and runs on itself all
do this, and `packages/cli/src/workflow-injection.test.ts` fails the build if an expression
reappears inside one of their `run:` scripts. If you copy a workflow out of this repository and
edit it, keep that rule.

## Scope

In-scope: the Warden packages, CLI, and GitHub Action. Out-of-scope: vulnerabilities in third-party dependencies (report those upstream), and issues requiring a compromised CI environment or maintainer machine.
