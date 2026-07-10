import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import {
  evaluateLoadGate,
  k6LoadResultsToCtrf,
  type K6LoadSummary,
  type K6LoadThresholds,
} from './k6-load';

const withinBudget: K6LoadSummary = {
  p95Ms: 600,
  p99Ms: 1200,
  errorRate: 0.005,
  requests: 15000,
};

const breached: K6LoadSummary = {
  p95Ms: 900,
  p99Ms: 1200,
  errorRate: 0.05,
  requests: 15000,
};

const thresholds: K6LoadThresholds = {
  p95Ms: 800,
  p99Ms: 1500,
  errorRate: 0.01,
};

describe('k6LoadResultsToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const report = k6LoadResultsToCtrf(withinBudget, thresholds);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool to warden-load', () => {
    expect(k6LoadResultsToCtrf(withinBudget, thresholds).results.tool.name).toBe('warden-load');
  });

  it('emits one test per threshold', () => {
    const { tests } = k6LoadResultsToCtrf(withinBudget, thresholds).results;
    expect(tests).toHaveLength(3);
    expect(tests.map((t) => t.name)).toEqual(['p95Ms <800ms', 'p99Ms <1500ms', 'errorRate <0.01']);
  });

  it('marks all tests passed when the summary is within budget', () => {
    const { tests, summary } = k6LoadResultsToCtrf(withinBudget, thresholds).results;
    expect(tests.every((t) => t.status === 'passed')).toBe(true);
    expect(summary).toMatchObject({ tests: 3, passed: 3, failed: 0 });
  });

  it('marks a breached threshold failed with a message', () => {
    const { tests } = k6LoadResultsToCtrf(breached, thresholds).results;
    const p95Test = tests.find((t) => t.name === 'p95Ms <800ms');
    const errorRateTest = tests.find((t) => t.name === 'errorRate <0.01');
    expect(p95Test?.status).toBe('failed');
    expect(p95Test?.message).toContain('exceeds budget');
    expect(errorRateTest?.status).toBe('failed');
  });

  it('leaves an unbreached threshold passed alongside a breached one', () => {
    const { tests } = k6LoadResultsToCtrf(breached, thresholds).results;
    const p99Test = tests.find((t) => t.name === 'p99Ms <1500ms');
    expect(p99Test?.status).toBe('passed');
  });
});

describe('evaluateLoadGate', () => {
  it('PASSes when the summary is within budget', () => {
    const report = k6LoadResultsToCtrf(withinBudget, thresholds);
    expect(evaluateLoadGate(report, withinBudget)).toEqual({
      decision: 'PASS',
      reason: expect.any(String),
    });
  });

  it('BLOCKs when p95 latency is breached', () => {
    const summary = { ...withinBudget, p95Ms: 900 };
    const gate = evaluateLoadGate(k6LoadResultsToCtrf(summary, thresholds), summary);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('p95Ms');
  });

  it('BLOCKs when the error rate is breached', () => {
    const summary = { ...withinBudget, errorRate: 0.05 };
    const gate = evaluateLoadGate(k6LoadResultsToCtrf(summary, thresholds), summary);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('errorRate');
  });

  it('BLOCKs and reports every breached threshold when multiple are breached', () => {
    const gate = evaluateLoadGate(k6LoadResultsToCtrf(breached, thresholds), breached);
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('p95Ms');
    expect(gate.reason).toContain('errorRate');
  });

  it('WARNs when the load run issued zero requests (measured nothing)', () => {
    const zeroRequests: K6LoadSummary = { p95Ms: 0, p99Ms: 0, errorRate: 0, requests: 0 };
    const gate = evaluateLoadGate(k6LoadResultsToCtrf(zeroRequests, thresholds), zeroRequests);
    expect(gate.decision).toBe('WARN');
    expect(gate.reason).toMatch(/zero requests/i);
  });
});
