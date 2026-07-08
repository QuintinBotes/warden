import { describe, expect, it } from 'vitest';
import { CTRFReportSchema, type SchemathesisReport } from '@warden/core';
import { evaluateSchemathesisGate, schemathesisJsonToCtrf } from './schemathesis';

const cleanReport: SchemathesisReport = {
  schemaUrl: 'https://preview.internal/openapi.json',
  endpoints: [
    { method: 'GET', path: '/orders/{id}', checksRun: 4, failures: [] },
    { method: 'GET', path: '/health', checksRun: 2, failures: [] },
  ],
};

const serverErrorReport: SchemathesisReport = {
  schemaUrl: 'https://preview.internal/openapi.json',
  endpoints: [
    {
      method: 'POST',
      path: '/orders',
      checksRun: 4,
      failures: [
        {
          checkName: 'not_a_server_error',
          message: 'Received a 500 response',
          example: { body: { total: -1 } },
          seed: '12345',
        },
      ],
    },
  ],
};

const schemaConformanceReport: SchemathesisReport = {
  schemaUrl: 'https://preview.internal/openapi.json',
  endpoints: [
    {
      method: 'GET',
      path: '/orders/{id}',
      checksRun: 4,
      failures: [
        {
          checkName: 'response_schema_conformance',
          message: 'Response does not conform to schema',
        },
      ],
    },
  ],
};

const otherCheckReport: SchemathesisReport = {
  schemaUrl: 'https://preview.internal/openapi.json',
  endpoints: [
    {
      method: 'GET',
      path: '/orders',
      checksRun: 4,
      failures: [{ checkName: 'response_headers_conformance', message: 'Missing header' }],
    },
  ],
};

describe('schemathesisJsonToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const report = schemathesisJsonToCtrf(cleanReport);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool to schemathesis', () => {
    expect(schemathesisJsonToCtrf(cleanReport).results.tool.name).toBe('schemathesis');
  });

  it('emits one passed test per endpoint with no failures', () => {
    const { tests, summary } = schemathesisJsonToCtrf(cleanReport).results;
    expect(tests).toHaveLength(2);
    expect(tests.every((t) => t.status === 'passed')).toBe(true);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it('emits one failed test per check failure, tagged with the check name', () => {
    const { tests } = schemathesisJsonToCtrf(serverErrorReport).results;
    expect(tests).toHaveLength(1);
    expect(tests[0]?.status).toBe('failed');
    expect(tests[0]?.name).toBe('POST /orders — not_a_server_error');
    expect(tests[0]?.tags).toContain('not_a_server_error');
    expect(tests[0]?.extra?.checkName).toBe('not_a_server_error');
    expect(tests[0]?.extra?.example).toEqual({ body: { total: -1 } });
    expect(tests[0]?.extra?.seed).toBe('12345');
  });

  it('handles an empty endpoints list', () => {
    const report = schemathesisJsonToCtrf({ schemaUrl: 'x', endpoints: [] });
    expect(report.results.tests).toHaveLength(0);
    expect(report.results.summary.tests).toBe(0);
  });
});

describe('evaluateSchemathesisGate', () => {
  it('PASSes a clean report', () => {
    const gate = evaluateSchemathesisGate(schemathesisJsonToCtrf(cleanReport));
    expect(gate.decision).toBe('PASS');
  });

  it('BLOCKs on a not_a_server_error failure', () => {
    const gate = evaluateSchemathesisGate(schemathesisJsonToCtrf(serverErrorReport));
    expect(gate.decision).toBe('BLOCK');
  });

  it('BLOCKs on a response_schema_conformance failure', () => {
    const gate = evaluateSchemathesisGate(schemathesisJsonToCtrf(schemaConformanceReport));
    expect(gate.decision).toBe('BLOCK');
  });

  it('WARNs on a failure outside the blocking check set', () => {
    const gate = evaluateSchemathesisGate(schemathesisJsonToCtrf(otherCheckReport));
    expect(gate.decision).toBe('WARN');
  });
});
