import { describe, expect, it } from 'vitest';
import type { ContractVerificationResult, PactInteraction } from '@warden/core';
import { contractDriftImpact } from './contract-impact.js';

function interaction(description: string): PactInteraction {
  return {
    description,
    request: { method: 'GET', path: '/orders/1' },
    response: { status: 200 },
  };
}

function passingResult(consumer: string, provider: string): ContractVerificationResult {
  return {
    consumer,
    provider,
    checks: [{ interaction: interaction('get order'), success: true, mismatches: [] }],
  };
}

function failingResult(
  consumer: string,
  provider: string,
  failedDescriptions: string[],
): ContractVerificationResult {
  return {
    consumer,
    provider,
    checks: failedDescriptions.map((description) => ({
      interaction: interaction(description),
      success: false,
      mismatches: [{ path: 'status', expected: 200, actual: 500 }],
    })),
  };
}

describe('contractDriftImpact', () => {
  it('returns no advisories for the empty-results no-op case', () => {
    expect(contractDriftImpact([], [], {})).toEqual([]);
  });

  it('returns no advisories when every interaction passed', () => {
    const results = [passingResult('web-app', 'checkout-service')];
    expect(contractDriftImpact(results, ['org/web-app'], { 'web-app': 'org/web-app' })).toEqual([]);
  });

  it('marks confidence high when the mapped repo is also a declared dependent', () => {
    const results = [failingResult('web-app', 'checkout-service', ['get order by id'])];
    const advisories = contractDriftImpact(results, ['org/web-app'], {
      'web-app': 'org/web-app',
    });
    expect(advisories).toEqual([
      {
        consumer: 'web-app',
        dependentRepo: 'org/web-app',
        confidence: 'high',
        failedInteractions: ['get order by id'],
        detail: expect.stringContaining('web-app'),
      },
    ]);
  });

  it('marks confidence low when the consumer is mapped but not declared as a dependent', () => {
    const results = [failingResult('web-app', 'checkout-service', ['get order by id'])];
    const advisories = contractDriftImpact(results, [], { 'web-app': 'org/web-app' });
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({
      consumer: 'web-app',
      dependentRepo: 'org/web-app',
      confidence: 'low',
    });
  });

  it('marks confidence low and leaves dependentRepo undefined when the consumer is declared but unmapped', () => {
    const results = [failingResult('mobile-app', 'checkout-service', ['get order by id'])];
    const advisories = contractDriftImpact(results, ['org/mobile-app'], {});
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({
      consumer: 'mobile-app',
      dependentRepo: undefined,
      confidence: 'low',
    });
  });

  it('lists every failed interaction description for a result', () => {
    const results = [
      failingResult('web-app', 'checkout-service', ['get order by id', 'list orders']),
    ];
    const advisories = contractDriftImpact(results, [], {});
    expect(advisories[0]?.failedInteractions).toEqual(['get order by id', 'list orders']);
  });

  it('only reports failing results, skipping passing ones in the same batch', () => {
    const results = [
      passingResult('mobile-app', 'checkout-service'),
      failingResult('web-app', 'checkout-service', ['get order by id']),
    ];
    const advisories = contractDriftImpact(results, [], {});
    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.consumer).toBe('web-app');
  });
});
