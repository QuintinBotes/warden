#!/usr/bin/env node
/**
 * Thin ops entry for `@warden/results-service`. This is the ONLY place that binds a port and
 * reads process state — the library itself (`createResultsServer`) never listens on import, so
 * it stays hermetically testable. Opt-in: the service refuses to start unless
 * `WARDEN_RESULTS_ENABLED=true`, and the HMAC secret comes from the environment, never config.
 *
 * Environment:
 *   WARDEN_RESULTS_ENABLED       must be "true" to start (default off)
 *   WARDEN_RESULTS_SECRET        HMAC secret for share tokens (required)
 *   WARDEN_PUBLIC_BASE_URL       base url minted share links are rooted at (required)
 *   WARDEN_RESULTS_TTL_SEC       share-token ttl in seconds (default 604800 = 7 days)
 *   WARDEN_RESULTS_PORT          port to bind (default 8787)
 *   WARDEN_DASHBOARD_API_MODULE  module exporting a DashboardDataApi factory
 *                                (`createDashboardDataApi` named export, or default)
 */
import { createHmacSigner, createResultsServer } from './dist/index.js';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[results-service] missing required env ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (process.env.WARDEN_RESULTS_ENABLED !== 'true') {
    console.error('[results-service] disabled; set WARDEN_RESULTS_ENABLED=true to start');
    process.exit(1);
  }

  const secret = required('WARDEN_RESULTS_SECRET');
  const publicBaseUrl = required('WARDEN_PUBLIC_BASE_URL');
  const tokenTtlSec = Number(process.env.WARDEN_RESULTS_TTL_SEC ?? 604800);
  const port = Number(process.env.WARDEN_RESULTS_PORT ?? 8787);

  const apiModuleId = required('WARDEN_DASHBOARD_API_MODULE');
  const mod = await import(apiModuleId);
  const factory = mod.createDashboardDataApi ?? mod.default;
  if (typeof factory !== 'function') {
    console.error(
      `[results-service] ${apiModuleId} must export createDashboardDataApi() or a default factory`,
    );
    process.exit(1);
  }
  const api = await factory();

  const server = createResultsServer({
    api,
    signer: createHmacSigner(secret),
    now: () => Date.now(),
    cfg: { resultsService: { enabled: true, tokenTtlSec, publicBaseUrl } },
  });

  server.listen(port, () => {
    console.log(`[results-service] listening on :${port}`);
  });
}

main().catch((err) => {
  console.error('[results-service] failed to start', err);
  process.exit(1);
});
