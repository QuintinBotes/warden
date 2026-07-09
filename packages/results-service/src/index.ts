/**
 * `@warden/results-service` — a hosted service that serves run results and mints public,
 * token-gated share links (a Currents-style shareable run URL). Opt-in and self-hostable;
 * every collaborator (dashboard-api, clock, signer secret) is injected, and the HMAC secret
 * comes from the environment, never config. Off by default.
 */
export { createHmacSigner } from './hmac-signer.js';
export { mintShareToken, resolveShare } from './share.js';
export { buildRunView, toSharedRunSummary } from './run-view.js';
export type { RedactedResult, RunView } from './run-view.js';
export { createResultsFacade } from './results-facade.js';
export type { ResultsFacade } from './results-facade.js';
export {
  createShareHandler,
  getRunHandler,
  listRunsHandler,
  sharedRunHandler,
} from './handlers.js';
export type { HandlerDeps, HandlerResult } from './handlers.js';
export { createResultsRequestListener, createResultsServer } from './server.js';
export type { ResultsServerDeps } from './server.js';
