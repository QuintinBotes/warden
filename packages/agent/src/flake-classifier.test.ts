import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import type { FailureContext, LLMProvider, TestResult } from '@warden/core';
import { createFlakeClassifier, heuristicRootCause } from './flake-classifier';

const config = defineConfig();

function result(status: TestResult['status']): TestResult {
  return {
    testCaseId: 'TC-001',
    status,
    duration: 10,
    retries: 0,
    flakeFlag: false,
    artifacts: [],
  };
}

function history(n: number): TestResult[] {
  return Array.from({ length: n }, (_, i) => result(i % 2 === 0 ? 'PASS' : 'FAIL'));
}

const failure: FailureContext = {
  testCode: '',
  errorMessage: 'locator.click: Timeout 30000ms exceeded waiting for button',
};

describe('createFlakeClassifier', () => {
  it('returns the provider tool-call classification when there is enough history', async () => {
    const provider = fakeProvider({
      toolCalls: [
        {
          name: 'classify_flake',
          input: {
            rootCause: 'selector',
            confidence: 0.82,
            explanation: 'Strict mode violation from an ambiguous locator.',
          },
        },
      ],
    });

    const classification = await createFlakeClassifier().classify(
      { testCaseId: 'TC-001', recentResults: history(4), latestFailure: failure },
      provider,
      config,
    );

    expect(classification.rootCause).toBe('selector');
    expect(classification.confidence).toBe(0.82);
    expect(classification.explanation).toContain('Strict mode');
    expect(classification.testCaseId).toBe('TC-001');
    expect(classification.classifiedAt).toBeInstanceOf(Date);
    expect(provider.calls).toHaveLength(1);
  });

  it('skips the LLM and uses a capped heuristic below minHistoryForClassification', async () => {
    const provider = fakeProvider({
      toolCalls: [{ name: 'classify_flake', input: { rootCause: 'network', explanation: 'x' } }],
    });

    const classification = await createFlakeClassifier().classify(
      { testCaseId: 'TC-001', recentResults: history(2), latestFailure: failure },
      provider,
      config,
    );

    // provider must not be consulted when history is below the minimum
    expect(provider.calls).toHaveLength(0);
    // heuristic classifies the timeout message as timing, capped at 0.3
    expect(classification.rootCause).toBe('timing');
    expect(classification.confidence).toBe(0.3);
  });

  it('falls back to the heuristic when the provider throws', async () => {
    const throwing: LLMProvider = {
      name: 'throwing',
      async generateText() {
        throw new Error('provider down');
      },
      async generateWithTools() {
        throw new Error('provider down');
      },
    };

    const classification = await createFlakeClassifier().classify(
      { testCaseId: 'TC-001', recentResults: history(5), latestFailure: failure },
      throwing,
      config,
    );

    expect(classification.rootCause).toBe('timing');
    expect(classification.confidence).toBe(0.4);
  });

  it('falls back to the heuristic when the provider returns no tool call', async () => {
    const provider = fakeProvider({ text: 'no idea' });
    const classification = await createFlakeClassifier().classify(
      { testCaseId: 'TC-001', recentResults: history(4), latestFailure: failure },
      provider,
      config,
    );
    expect(['timing', 'selector', 'data', 'network', 'unknown']).toContain(
      classification.rootCause,
    );
    expect(classification.confidence).toBe(0.4);
  });
});

describe('heuristicRootCause', () => {
  it('maps representative error strings to categories', () => {
    expect(heuristicRootCause('Timeout 30000ms exceeded')).toBe('timing');
    expect(heuristicRootCause('strict mode violation: locator resolved to 2 elements')).toBe(
      'selector',
    );
    expect(heuristicRootCause('connect ECONNRESET 127.0.0.1:5432')).toBe('network');
    expect(heuristicRootCause('expected 5 but received 4')).toBe('data');
    expect(heuristicRootCause('the run ended abnormally for reasons unrecorded')).toBe('unknown');
  });
});
