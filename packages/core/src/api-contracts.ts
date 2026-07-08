/**
 * API & contract testing types (WS-2). The subset of Schemathesis's report shape and Pact's
 * broker/verification shapes Warden consumes, plus the `PactBrokerClient` seam and the
 * cross-repo `ContractDriftAdvisory` `@warden/coverage-sync` correlates against `links.dependents`.
 */

// ── Schemathesis ────────────────────────────────────────────────────────────────────────────

/** A single failing Schemathesis check for one fuzzed example. */
export interface SchemathesisCheckFailure {
  checkName:
    'not_a_server_error' | 'response_schema_conformance' | 'status_code_conformance' | string;
  message: string;
  example?: Record<string, unknown>;
  seed?: string;
}

/** Fuzzing results for a single `method path` endpoint. */
export interface SchemathesisEndpointResult {
  method: string; // 'GET' | 'POST' | ...
  path: string; // '/orders/{id}'
  checksRun: number;
  failures: SchemathesisCheckFailure[];
}

/** The subset of a Schemathesis run's JSON report that Warden consumes. */
export interface SchemathesisReport {
  schemaUrl: string;
  endpoints: SchemathesisEndpointResult[];
}

// ── Pact ─────────────────────────────────────────────────────────────────────────────────────

export interface PactRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface PactResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface PactInteraction {
  description: string;
  providerState?: string;
  request: PactRequest;
  response: PactResponse; // the expected response
}

export interface PactContract {
  consumer: string;
  provider: string;
  pactUrl: string;
  interactions: PactInteraction[];
}

export interface ContractMismatch {
  path: string; // JSON-pointer-ish location, e.g. 'body.total' or 'status'
  expected: unknown;
  actual: unknown;
}

export interface ContractCheckResult {
  interaction: PactInteraction;
  success: boolean;
  mismatches: ContractMismatch[];
}

export interface ContractVerificationResult {
  consumer: string;
  provider: string;
  checks: ContractCheckResult[];
}

/** Injected access to a Pact Broker (self-hosted Pact Broker or Pactflow-compatible). */
export interface PactBrokerClient {
  fetchConsumerContracts(provider: string, tag?: string): Promise<PactContract[]>;
  publishVerificationResults(
    contract: PactContract,
    result: ContractVerificationResult,
    providerVersion: string,
  ): Promise<void>;
  canIDeploy(
    provider: string,
    providerVersion: string,
    environment: string,
  ): Promise<{ deployable: boolean; reason: string }>;
}

/** Correlates a failed contract verification to the repo that owns the consumer, for cross-repo impact. */
export interface ContractDriftAdvisory {
  consumer: string;
  dependentRepo?: string; // resolved via api.pact.consumerRepoMap, when known
  confidence: 'high' | 'low'; // high when dependentRepo is also declared in links.dependents
  failedInteractions: string[]; // interaction descriptions
  detail: string;
}
