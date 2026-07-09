import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import {
  componentResultsToCtrf,
  evaluateComponentGate,
  type ComponentTestResult,
} from './component';

const allGreen: ComponentTestResult[] = [
  { name: 'Button renders label', status: 'passed', durationMs: 12, file: 'Button.ct.tsx' },
  { name: 'Button handles click', status: 'passed', durationMs: 8, file: 'Button.ct.tsx' },
  { name: 'Legacy widget', status: 'skipped', durationMs: 0, file: 'Widget.ct.tsx' },
];

const withFailure: ComponentTestResult[] = [
  { name: 'Button renders label', status: 'passed', durationMs: 12, file: 'Button.ct.tsx' },
  {
    name: 'Button disabled state',
    status: 'failed',
    durationMs: 15,
    file: 'Button.ct.tsx',
    message: 'expected disabled attribute to be present',
  },
  { name: 'Legacy widget', status: 'skipped', durationMs: 0, file: 'Widget.ct.tsx' },
];

describe('componentResultsToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const report = componentResultsToCtrf(allGreen);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool name to warden-component', () => {
    expect(componentResultsToCtrf(allGreen).results.tool.name).toBe('warden-component');
  });

  it('maps passed/failed/skipped statuses 1:1', () => {
    const { tests } = componentResultsToCtrf(withFailure).results;
    expect(tests.find((t) => t.name === 'Button renders label')?.status).toBe('passed');
    expect(tests.find((t) => t.name === 'Button disabled state')?.status).toBe('failed');
    expect(tests.find((t) => t.name === 'Legacy widget')?.status).toBe('skipped');
  });

  it('carries duration, file, and message through', () => {
    const { tests } = componentResultsToCtrf(withFailure).results;
    const failing = tests.find((t) => t.name === 'Button disabled state');
    expect(failing?.duration).toBe(15);
    expect(failing?.filePath).toBe('Button.ct.tsx');
    expect(failing?.message).toBe('expected disabled attribute to be present');
  });

  it('summarises pass/fail/skip counts', () => {
    const { summary } = componentResultsToCtrf(withFailure).results;
    expect(summary).toMatchObject({ tests: 3, passed: 1, failed: 1, skipped: 1 });
  });

  it('produces an empty-but-valid report for no results', () => {
    const report = componentResultsToCtrf([]);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
    expect(report.results.summary.tests).toBe(0);
  });
});

describe('evaluateComponentGate', () => {
  it('BLOCKs when any component test failed', () => {
    const gate = evaluateComponentGate(componentResultsToCtrf(withFailure));
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('1');
  });

  it('PASSes when all component tests passed or were skipped', () => {
    const gate = evaluateComponentGate(componentResultsToCtrf(allGreen));
    expect(gate.decision).toBe('PASS');
  });

  it('PASSes on an empty report', () => {
    expect(evaluateComponentGate(componentResultsToCtrf([])).decision).toBe('PASS');
  });
});
