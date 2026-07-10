import {
  CTRFReportSchema,
  type ContractCheckResult,
  type ContractMismatch,
  type ContractVerificationResult,
  type CTRFReport,
  type CTRFTest,
  type GateDecision,
  type PactBrokerClient,
  type PactContract,
  type PactInteraction,
  type PactRequest,
  type PactResponse,
} from '@warden/core';

/**
 * Pact provider-verification glue. The pure comparator {@link compareResponses}, the pure
 * `verifyContracts` (driven by an injected `invoke`), {@link pactVerificationToCtrf}, and the
 * pure gate {@link evaluatePactGate} are unit-tested; {@link runPactVerification}, which talks to
 * a live {@link PactBrokerClient} and provider, is integration-only and not unit-tested — same
 * split as `perf/k6.ts` and `security/zap.ts`.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function findHeader(headers: Record<string, string> | undefined, key: string): string | undefined {
  if (!headers) return undefined;
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function compareBody(expected: unknown, actual: unknown, path: string): ContractMismatch[] {
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const mismatches: ContractMismatch[] = [];
    for (const [key, value] of Object.entries(expected)) {
      mismatches.push(...compareBody(value, actual[key], `${path}.${key}`));
    }
    return mismatches;
  }
  if (deepEqual(expected, actual)) return [];
  return [{ path, expected, actual }];
}

/**
 * Pure: compares an actual response to an interaction's expected response. No network I/O.
 * Reports a `status` mismatch when status codes differ, one `headers.<name>` mismatch per
 * expected header that's missing or differs in `actual` (case-insensitive name match), and one
 * `body.<path>` mismatch per differing leaf field (recursing into plain objects, comparing
 * everything else — including arrays — by value).
 */
export function compareResponses(expected: PactResponse, actual: PactResponse): ContractMismatch[] {
  const mismatches: ContractMismatch[] = [];

  if (expected.status !== actual.status) {
    mismatches.push({ path: 'status', expected: expected.status, actual: actual.status });
  }

  for (const [name, value] of Object.entries(expected.headers ?? {})) {
    const actualValue = findHeader(actual.headers, name);
    if (actualValue !== value) {
      mismatches.push({ path: `headers.${name}`, expected: value, actual: actualValue });
    }
  }

  mismatches.push(...compareBody(expected.body, actual.body, 'body'));

  return mismatches;
}

/**
 * Verifies every interaction in `contracts` by sending its `request` through `invoke` (injected —
 * in CI this posts to a running preview build; in tests it's a fake returning canned responses)
 * and comparing via {@link compareResponses}. No broker or network access beyond `invoke`. An
 * `invoke` rejection is caught per-interaction and recorded as a failed check rather than thrown,
 * so one unreachable endpoint fails that interaction, not the whole verification run.
 */
export async function verifyContracts(
  contracts: PactContract[],
  invoke: (req: PactRequest) => Promise<PactResponse>,
): Promise<ContractVerificationResult[]> {
  const results: ContractVerificationResult[] = [];

  for (const contract of contracts) {
    const checks: ContractCheckResult[] = [];
    for (const interaction of contract.interactions) {
      try {
        const actual = await invoke(interaction.request);
        const mismatches = compareResponses(interaction.response, actual);
        checks.push({ interaction, success: mismatches.length === 0, mismatches });
      } catch (err) {
        checks.push({
          interaction,
          success: false,
          mismatches: [{ path: 'error', expected: 'a response', actual: (err as Error).message }],
        });
      }
    }
    results.push({ consumer: contract.consumer, provider: contract.provider, checks });
  }

  return results;
}

function interactionLabel(interaction: PactInteraction): string {
  return interaction.description;
}

/**
 * Pure converter from {@link ContractVerificationResult}s to a {@link CTRFReport}. Each verified
 * interaction becomes one CTRF test, named `<consumer> -> <provider>: <interaction>`, tagged with
 * the consumer/provider; failed interactions carry their {@link ContractMismatch}es in `extra`.
 * Output is validated with {@link CTRFReportSchema}.
 */
export function pactVerificationToCtrf(results: ContractVerificationResult[]): CTRFReport {
  const tests: CTRFTest[] = [];

  for (const result of results) {
    for (const check of result.checks) {
      const test: CTRFTest = {
        name: `${result.consumer} -> ${result.provider}: ${interactionLabel(check.interaction)}`,
        status: check.success ? 'passed' : 'failed',
        duration: 0,
        tags: [result.consumer, result.provider, 'contract'],
      };
      if (!check.success) {
        test.message = `contract mismatch: ${check.mismatches.map((m) => m.path).join(', ')}`;
        test.extra = { mismatches: check.mismatches };
      }
      tests.push(test);
    }
  }

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'pact' },
      summary: {
        tests: tests.length,
        passed: tests.filter((t) => t.status === 'passed').length,
        failed: tests.filter((t) => t.status === 'failed').length,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 0,
      },
      tests,
    },
  });
}

/**
 * Pure gate mapping over {@link ContractVerificationResult}s. Any failed interaction check →
 * `BLOCK` (a broken contract is a breaking change for a live consumer); zero interactions verified
 * at all (no contracts found) → `WARN` (a config/broker gap, not a clean bill); otherwise `PASS`.
 */
export function evaluatePactGate(results: ContractVerificationResult[]): GateDecision {
  const checks = results.flatMap((r) => r.checks);
  const failed = checks.filter((c) => !c.success);
  if (failed.length > 0) {
    return {
      decision: 'BLOCK',
      reason: `${failed.length} contract interaction(s) failed verification`,
    };
  }
  // No interactions were verified at all (broker returned no contracts, wrong provider name, or a
  // tag that matched nothing). "0 verified" is a broker/config gap, not "all verified".
  if (checks.length === 0) {
    return {
      decision: 'WARN',
      reason:
        'no consumer contract interactions were verified (no contracts found — broker/tag misconfiguration?)',
    };
  }
  return { decision: 'PASS', reason: 'all contract interactions verified' };
}

/** Options for {@link runPactVerification}. */
export interface RunPactVerificationOptions {
  /** Typically the PR's head SHA. */
  providerVersion: string;
  /** Broker consumer-version tag to pull contracts for, e.g. `'main'`. */
  tag?: string;
  /** Environment for the post-verification `canIDeploy` check. */
  environment?: string;
  /** Defaults to `config.api.pact.publishVerificationResults` (`true`). */
  publish?: boolean;
}

/** Result of a {@link runPactVerification} run. */
export interface RunPactVerificationResult {
  contracts: PactContract[];
  results: ContractVerificationResult[];
  report: CTRFReport;
  gate: GateDecision;
  canIDeploy?: { deployable: boolean; reason: string };
}

/**
 * Integration glue: fetches this provider's consumer contracts from `broker`, verifies them
 * against `invoke`, converts + gates the results, and (if `publish`) writes verification results
 * and a `canIDeploy` check back to the broker. NOT unit-tested (needs a live broker + provider);
 * {@link compareResponses}, {@link verifyContracts} (with a fake `invoke`), and
 * {@link evaluatePactGate} are unit-tested instead.
 */
export async function runPactVerification(
  providerName: string,
  broker: PactBrokerClient,
  invoke: (req: PactRequest) => Promise<PactResponse>,
  opts: RunPactVerificationOptions,
): Promise<RunPactVerificationResult> {
  const contracts = await broker.fetchConsumerContracts(providerName, opts.tag);
  const results = await verifyContracts(contracts, invoke);
  const report = pactVerificationToCtrf(results);
  const gate = evaluatePactGate(results);

  const publish = opts.publish ?? true;
  let canIDeploy: { deployable: boolean; reason: string } | undefined;

  if (publish) {
    for (let i = 0; i < contracts.length; i++) {
      const contract = contracts[i]!;
      const result = results[i]!;
      await broker.publishVerificationResults(contract, result, opts.providerVersion);
    }
    if (opts.environment) {
      canIDeploy = await broker.canIDeploy(providerName, opts.providerVersion, opts.environment);
    }
  }

  return { contracts, results, report, gate, canIDeploy };
}
