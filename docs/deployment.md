# Deployment & Self-Hosting

Warden is designed to be **self-hostable with zero managed services**. There are two deployment modes, and most teams use both:

1. **CI-embedded** (the default) — Warden runs inside your existing GitHub Actions pipeline. Nothing to host.
2. **Self-hosted stack** — you additionally run the persistent dashboard and metrics stack (v2) to track trends over time.

---

## Mode 1 — CI-embedded (recommended start)

This is the whole product for most teams: the [GitHub Action](github-action.md) runs Warden on each PR, results land in GitHub, and execution history is written to a SQLite file kept as a build artifact or committed to a branch. There is no server to operate.

### Requirements

- GitHub Actions (hosted or self-hosted runners).
- An `ANTHROPIC_API_KEY` repository secret.
- Your app must start in CI and be reachable over HTTP (a preview URL or `localhost`).

### Bringing up the app under test

Warden tests a running application. Start it before the QA steps:

```yaml
      - run: npm ci
      - name: Start app
        run: npm run dev &
      - run: npx wait-on http://localhost:3000 --timeout 60000
```

For apps with a preview-deploy step (Vercel, Netlify, a container in the job), pass the preview URL to `warden agent --url` instead.

### Secrets

| Secret | Purpose | Notes |
|--------|---------|-------|
| `ANTHROPIC_API_KEY` | The AI engine | Never logged or written to disk. |
| `GITHUB_TOKEN` | PR comments + check runs | The built-in `${{ secrets.GITHUB_TOKEN }}` is enough. |

Rotate keys on your normal cadence; Warden reads them only from the environment.

### Choosing runners

| Runner | When |
|--------|------|
| GitHub-hosted `ubuntu-latest` | Default. Playwright's official image or `--with-deps` installs browsers. |
| Self-hosted | Larger repos, private networks, or to control cost. Pre-install the Playwright browsers on the image. |

The Playwright container `mcr.microsoft.com/playwright:v1.52.0-noble` avoids per-run browser installs.

### Cost control

- Warden is **selective by default** — small diffs run only smoke + scoped regression, so the AI agent (the only paid step) fires on a fraction of PRs.
- Raise `tiers.aiExploratory.riskThreshold` to run the agent less often.
- Set `ai.model` to a smaller model for routine PRs and reserve Opus for high-risk paths.
- Use `ai.fallbackProvider: 'ollama'` to run a **local model** when no key is present — useful for forks and air-gapped runners.

### Data & retention

- **Execution history**: a SQLite file (`@warden/test-management`). Persist it as an Actions artifact, or commit it to a `warden-history` branch, or point it at a shared volume on a self-hosted runner.
- **Media** (screenshots, videos, traces): written to the artifacts directory and uploaded with `actions/upload-artifact`. Set a retention policy that matches your compliance needs.
- **Test cases**: plain YAML in `tests/cases/`, versioned with your code.

---

## Mode 2 — Self-hosted stack (v2)

To keep trends, coverage history, and the requirements dashboard, run the self-hosted stack. It is a single `docker compose` command and uses only open-source images.

> The dashboard and observability components ship in **v2**. The compose file below is the target deployment; track progress in the [v2 spec](superpowers/specs/2026-07-07-warden-v2-design.md).

### Components

| Service | Image | Port | Role |
|---------|-------|------|------|
| Dashboard | `warden/dashboard` | 3001 | Coverage matrix, trends, flake board, E2E replay, learning content |
| Pushgateway | `prom/pushgateway` | 9091 | Receives metrics from each CI run |
| Prometheus | `prom/prometheus` | 9090 | Stores time-series metrics |
| Grafana | `grafana/grafana` | 3000 | Pre-provisioned QA dashboards |

### `docker-compose.yml`

```yaml
services:
  dashboard:
    image: warden/dashboard:latest
    ports: ['3001:3001']
    environment:
      - WARDEN_DB=/data/warden.sqlite
      - PROMETHEUS_URL=http://prometheus:9090
    volumes:
      - warden-data:/data

  pushgateway:
    image: prom/pushgateway:latest
    ports: ['9091:9091']

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    ports: ['9090:9090']

  grafana:
    image: grafana/grafana:latest
    ports: ['3000:3000']
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD:-admin}
    volumes:
      - ./monitoring/dashboards:/var/lib/grafana/dashboards
      - ./monitoring/provisioning:/etc/grafana/provisioning

volumes:
  warden-data:
```

Bring it up:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

### Wiring CI to the stack

Point the Action at your pushgateway so each run publishes metrics:

```ts
// warden.config.ts
export default defineConfig({
  reporting: {
    prometheus: {
      enabled: true,
      pushgatewayUrl: process.env.PROMETHEUS_PUSHGATEWAY_URL,
    },
  },
});
```

The dashboard reads the same SQLite history your CI writes, so a shared volume (or a synced copy) is the only integration point.

### What the dashboard shows

- **Coverage matrix** — requirement × test × last result.
- **Trends** — pass rate, flake rate, MTTR, escaped-defect rate, suite-duration, coverage delta per PR.
- **Flake board** — quarantined tests and their flake rates.
- **E2E replay** — the captured video, screenshot gallery, and trace for any failing or flaky test.
- **Learning content** — narrated learning videos/articles generated from tested flows (when enabled).

---

## Security & operations

- **No inbound access required for Mode 1.** Warden runs inside CI and talks out to the Anthropic API and the GitHub API only.
- **Least privilege.** Grant the workflow only `contents: read`, `pull-requests: write`, `checks: write`. Add `contents: write` only if you enable committing generated tests.
- **Local-only browsing.** The `claude-chrome` engine drives a real browser with your session and is intended for local developer machines, not shared CI. CI uses headless Playwright.
- **Backups.** The only stateful artifact is the SQLite history file and your media artifacts. Back these up like any other build data.

## Upgrades

Warden follows semver. Pin the Action to a major tag (`@v1`) to get compatible updates automatically, or to a full version for reproducibility. The `warden.config.ts` schema is validated on load, so an incompatible option fails fast with a clear message rather than silently misbehaving.
