# Self-hosting Warden

The full Warden stack — dashboard + metrics — runs from one compose file using only open-source images. See also [docs/deployment.md](../docs/deployment.md).

## Quick start

```bash
# 1. Build the static dashboard (reads the seeded snapshot; regenerate with `pnpm --filter dashboard snapshot`)
pnpm --filter dashboard build

# 2. Bring up the stack
docker compose -f deploy/docker-compose.yml up -d
```

| Service | URL | Purpose |
|---------|-----|---------|
| Dashboard | http://localhost:3001 | Coverage matrix, trends, gate, E2E replay, learning |
| Grafana | http://localhost:3000 | Pre-provisioned QA dashboards (login `admin` / `$GRAFANA_PASSWORD`) |
| Prometheus | http://localhost:9090 | Metrics store |
| Pushgateway | http://localhost:9091 | Where each CI run pushes metrics |

Set a Grafana password:

```bash
GRAFANA_PASSWORD=change-me docker compose -f deploy/docker-compose.yml up -d
```

## Wiring CI to the stack

Point Warden's config at your pushgateway so every run publishes metrics:

```ts
// warden.config.ts
export default {
  reporting: {
    prometheus: { enabled: true, pushgatewayUrl: process.env.PROMETHEUS_PUSHGATEWAY_URL },
  },
};
```

## Notes

- The dashboard is a static export served by nginx. Rebuild (`pnpm --filter dashboard build`) to refresh it; in production, wire the snapshot step to your real execution store.
- Prometheus and Grafana configs live in [`packages/observability/monitoring/`](../packages/observability/monitoring/) and are mounted read-only.
- Nothing here needs inbound internet access; the stack is self-contained.
