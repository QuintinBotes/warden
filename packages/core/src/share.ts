/**
 * Hosted results service contracts. A share token grants read-only access to one run's results
 * via a public link, without an account — the token IS the credential. `@warden/results-service`
 * implements the signer + the HTTP surface. Opt-in and self-hostable; secrets come from the
 * environment, never config.
 */

export interface ShareTokenPayload {
  /** The execution this token grants read access to. */
  executionId: string;
  /** Reserved for future scopes; always `'run'` today. */
  scope: 'run';
  /** Epoch milliseconds the token was issued. */
  issuedAt: number;
  /** Epoch milliseconds the token expires. */
  expiresAt: number;
}

/** Signs + verifies share tokens. The HMAC implementation lives in `@warden/results-service`. */
export interface ShareTokenSigner {
  /** Produce an opaque, URL-safe token string for the payload. */
  sign(payload: ShareTokenPayload): string;
  /** Return the payload if the token's signature is valid and it hasn't expired at `nowMs`, else null. */
  verify(token: string, nowMs: number): ShareTokenPayload | null;
}

/** A run summary the hosted service exposes (derived from a `TestExecution`). */
export interface SharedRunSummary {
  executionId: string;
  triggerRef: string;
  environment: string;
  startedAt: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
}
