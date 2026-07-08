import { describe, expect, it } from 'vitest';
import {
  CTRFReportSchema,
  type ContractVerificationResult,
  type PactContract,
  type PactRequest,
  type PactResponse,
} from '@warden/core';
import {
  compareResponses,
  evaluatePactGate,
  pactVerificationToCtrf,
  verifyContracts,
} from './pact';

describe('compareResponses', () => {
  it('returns no mismatches for a matching response', () => {
    const expected: PactResponse = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { total: 10 },
    };
    const actual: PactResponse = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { total: 10 },
    };
    expect(compareResponses(expected, actual)).toEqual([]);
  });

  it('reports a status mismatch', () => {
    const expected: PactResponse = { status: 200, body: {} };
    const actual: PactResponse = { status: 500, body: {} };
    expect(compareResponses(expected, actual)).toEqual([
      { path: 'status', expected: 200, actual: 500 },
    ]);
  });

  it('reports a missing header', () => {
    const expected: PactResponse = { status: 200, headers: { 'X-Trace-Id': 'abc' } };
    const actual: PactResponse = { status: 200, headers: {} };
    expect(compareResponses(expected, actual)).toEqual([
      { path: 'headers.X-Trace-Id', expected: 'abc', actual: undefined },
    ]);
  });

  it('reports a body field mismatch', () => {
    const expected: PactResponse = { status: 200, body: { total: 10, currency: 'USD' } };
    const actual: PactResponse = { status: 200, body: { total: 12, currency: 'USD' } };
    expect(compareResponses(expected, actual)).toEqual([
      { path: 'body.total', expected: 10, actual: 12 },
    ]);
  });

  it('reports multiple mismatches together', () => {
    const expected: PactResponse = { status: 200, body: { total: 10 } };
    const actual: PactResponse = { status: 404, body: { total: 12 } };
    const mismatches = compareResponses(expected, actual);
    expect(mismatches).toContainEqual({ path: 'status', expected: 200, actual: 404 });
    expect(mismatches).toContainEqual({ path: 'body.total', expected: 10, actual: 12 });
  });
});

const contract: PactContract = {
  consumer: 'web-app',
  provider: 'checkout-service',
  pactUrl: 'https://broker.internal/pacts/web-app/checkout-service',
  interactions: [
    {
      description: 'get order by id',
      request: { method: 'GET', path: '/orders/1' },
      response: { status: 200, body: { total: 10 } },
    },
    {
      description: 'get missing order',
      request: { method: 'GET', path: '/orders/999' },
      response: { status: 404, body: { error: 'not found' } },
    },
  ],
};

describe('verifyContracts', () => {
  it('verifies every interaction against invoke and reports matches/mismatches', async () => {
    const invoke = async (req: PactRequest): Promise<PactResponse> => {
      if (req.path === '/orders/1') return { status: 200, body: { total: 10 } };
      return { status: 404, body: { error: 'nope' } };
    };

    const [result] = await verifyContracts([contract], invoke);
    expect(result?.consumer).toBe('web-app');
    expect(result?.provider).toBe('checkout-service');
    expect(result?.checks).toHaveLength(2);
    expect(result?.checks[0]?.success).toBe(true);
    expect(result?.checks[0]?.mismatches).toEqual([]);
    expect(result?.checks[1]?.success).toBe(false);
    expect(result?.checks[1]?.mismatches).toEqual([
      { path: 'body.error', expected: 'not found', actual: 'nope' },
    ]);
  });

  it('records a failed check when invoke throws, without crashing the run', async () => {
    const invoke = async (): Promise<PactResponse> => {
      throw new Error('connection refused');
    };

    const [result] = await verifyContracts([contract], invoke);
    expect(result?.checks).toHaveLength(2);
    expect(result?.checks.every((c) => c.success === false)).toBe(true);
    expect(result?.checks[0]?.mismatches[0]?.actual).toBe('connection refused');
  });

  it('handles an empty contracts list', async () => {
    const results = await verifyContracts([], async () => ({ status: 200 }));
    expect(results).toEqual([]);
  });
});

describe('pactVerificationToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const results: ContractVerificationResult[] = [
      {
        consumer: 'web-app',
        provider: 'checkout-service',
        checks: [
          {
            interaction: contract.interactions[0]!,
            success: true,
            mismatches: [],
          },
          {
            interaction: contract.interactions[1]!,
            success: false,
            mismatches: [{ path: 'status', expected: 404, actual: 500 }],
          },
        ],
      },
    ];
    const report = pactVerificationToCtrf(results);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
    expect(report.results.tool.name).toBe('pact');
    expect(report.results.tests).toHaveLength(2);
    expect(report.results.summary.passed).toBe(1);
    expect(report.results.summary.failed).toBe(1);
    const failedTest = report.results.tests.find((t) => t.status === 'failed');
    expect(failedTest?.name).toBe('web-app -> checkout-service: get missing order');
    expect(failedTest?.extra?.mismatches).toEqual([{ path: 'status', expected: 404, actual: 500 }]);
  });
});

describe('evaluatePactGate', () => {
  it('PASSes when every interaction matched', () => {
    const results: ContractVerificationResult[] = [
      {
        consumer: 'web-app',
        provider: 'checkout-service',
        checks: [{ interaction: contract.interactions[0]!, success: true, mismatches: [] }],
      },
    ];
    expect(evaluatePactGate(results).decision).toBe('PASS');
  });

  it('BLOCKs when any interaction check failed', () => {
    const results: ContractVerificationResult[] = [
      {
        consumer: 'web-app',
        provider: 'checkout-service',
        checks: [
          { interaction: contract.interactions[0]!, success: true, mismatches: [] },
          {
            interaction: contract.interactions[1]!,
            success: false,
            mismatches: [{ path: 'status', expected: 404, actual: 500 }],
          },
        ],
      },
    ];
    expect(evaluatePactGate(results).decision).toBe('BLOCK');
  });
});
