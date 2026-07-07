import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import { evaluateK6Thresholds, k6SummaryToCtrf, type K6Summary } from './k6';

const k6Summary: K6Summary = {
  state: { testRunDurationMs: 60000 },
  metrics: {
    http_req_duration: {
      thresholds: {
        'p(95)<500': { ok: true },
        'p(99)<1000': { ok: false },
      },
      values: { avg: 120, med: 100, 'p(95)': 480, 'p(99)': 1200, max: 2000 },
    },
    http_reqs: {
      values: { count: 3000, rate: 50 },
    },
    http_req_failed: {
      thresholds: { 'rate<0.01': { ok: true } },
      values: { rate: 0.002 },
    },
  },
};

describe('k6SummaryToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const report = k6SummaryToCtrf(k6Summary);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool to k6', () => {
    expect(k6SummaryToCtrf(k6Summary).results.tool.name).toBe('k6');
  });

  it('emits one test per threshold (metrics without thresholds are skipped)', () => {
    const { tests } = k6SummaryToCtrf(k6Summary).results;
    // http_req_duration has 2 thresholds, http_req_failed has 1; http_reqs has none.
    expect(tests).toHaveLength(3);
    expect(tests.map((t) => t.name)).toContain('http_req_duration: p(95)<500');
  });

  it('marks held thresholds passed and breached thresholds failed', () => {
    const { tests } = k6SummaryToCtrf(k6Summary).results;
    const held = tests.find((t) => t.name === 'http_req_duration: p(95)<500');
    const breached = tests.find((t) => t.name === 'http_req_duration: p(99)<1000');
    expect(held?.status).toBe('passed');
    expect(breached?.status).toBe('failed');
    expect(breached?.message).toContain('breached');
  });

  it('computes a summary and carries the run duration as stop', () => {
    const { summary } = k6SummaryToCtrf(k6Summary).results;
    expect(summary).toMatchObject({ tests: 3, passed: 2, failed: 1, skipped: 0, other: 0 });
    expect(summary.stop).toBe(60000);
  });

  it('returns an empty report for an empty summary', () => {
    const report = k6SummaryToCtrf({});
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
    expect(report.results.tests).toHaveLength(0);
  });
});

describe('evaluateK6Thresholds', () => {
  it('PASSes when p95 and throughput are within limits', () => {
    expect(evaluateK6Thresholds(k6Summary, { p95Ms: 500, throughput: 40 })).toEqual({
      decision: 'PASS',
      reason: expect.any(String),
    });
  });

  it('BLOCKs when p95 latency exceeds the limit', () => {
    const gate = evaluateK6Thresholds(k6Summary, { p95Ms: 300 });
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('p95');
  });

  it('BLOCKs when throughput is below the required minimum', () => {
    const gate = evaluateK6Thresholds(k6Summary, { throughput: 100 });
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('throughput');
  });

  it('combines multiple breaches into one reason', () => {
    const gate = evaluateK6Thresholds(k6Summary, { p95Ms: 100, throughput: 100 });
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('p95');
    expect(gate.reason).toContain('throughput');
  });
});
