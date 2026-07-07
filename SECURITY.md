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

## Scope

In-scope: the Warden packages, CLI, and GitHub Action. Out-of-scope: vulnerabilities in third-party dependencies (report those upstream), and issues requiring a compromised CI environment or maintainer machine.
