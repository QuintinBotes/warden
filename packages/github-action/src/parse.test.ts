import { describe, expect, it } from 'vitest';
import { WardenError } from '@warden/core';
import { parseAggregateReport, parseGithubOutput } from './parse.js';

describe('parseGithubOutput', () => {
  it('parses the analyze key=value lines the CLI emits', () => {
    const out = parseGithubOutput('test_tags=@apps/checkout\nrisk_score=7\nrun_full_suite=false\n');
    expect(out).toEqual({
      test_tags: '@apps/checkout',
      risk_score: '7',
      run_full_suite: 'false',
    });
  });

  it('ignores blank lines, comments, and lines without =', () => {
    const out = parseGithubOutput('# a comment\n\nrisk_score=3\ngarbage line\n');
    expect(out).toEqual({ risk_score: '3' });
  });

  it('keeps = characters inside the value', () => {
    const out = parseGithubOutput('token=a=b=c');
    expect(out.token).toBe('a=b=c');
  });
});

describe('parseAggregateReport', () => {
  it('parses a JSON gate report from stdout', () => {
    const stdout = JSON.stringify({
      gate: { decision: 'BLOCK', reason: '1 CRITICAL failure(s)' },
      reportPath: 'warden-reports/warden-ctrf.json',
      summary: { total: 47, passed: 44, failed: 3 },
      failures: [{ path: 'a.ts', line: 2, message: 'boom', title: 't', priority: 'P1' }],
    });
    const report = parseAggregateReport(stdout);
    expect(report.gate).toEqual({ decision: 'BLOCK', reason: '1 CRITICAL failure(s)' });
    expect(report.reportPath).toBe('warden-reports/warden-ctrf.json');
    expect(report.summary).toEqual({ total: 47, passed: 44, failed: 3 });
    expect(report.failures?.[0]?.path).toBe('a.ts');
  });

  it('tolerates a string gate and log noise around the JSON', () => {
    const stdout = 'info: aggregating\n{"gate":"PASS","reason":"all good"}\ndone\n';
    const report = parseAggregateReport(stdout);
    expect(report.gate).toEqual({ decision: 'PASS', reason: 'all good' });
  });

  it('throws a WardenError when there is no JSON', () => {
    expect(() => parseAggregateReport('no json here')).toThrow(WardenError);
  });

  it('fails closed (BLOCK) on an unrecognized gate decision', () => {
    const report = parseAggregateReport(JSON.stringify({ gate: { decision: 'WEIRD' } }));
    expect(report.gate.decision).toBe('BLOCK');
  });

  it('fails closed (BLOCK) when the gate decision is missing', () => {
    const report = parseAggregateReport(JSON.stringify({ gate: { reason: 'x' } }));
    expect(report.gate.decision).toBe('BLOCK');
  });

  it('still honors an explicit PASS decision', () => {
    const report = parseAggregateReport(
      JSON.stringify({ gate: { decision: 'PASS', reason: 'ok' } }),
    );
    expect(report.gate).toEqual({ decision: 'PASS', reason: 'ok' });
  });
});
