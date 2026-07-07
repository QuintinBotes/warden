import { describe, it, expect } from 'vitest';
import { defineConfig } from '@warden/core';
import { fixtureChangeSurface } from '@warden/core/testing';
import { dispatchAgents } from './index';

// Default aiExploratory.riskThreshold is 4.
const cfg = defineConfig();

describe('dispatchAgents', () => {
  it('dispatches nothing below the exploratory threshold', () => {
    const out = dispatchAgents(fixtureChangeSurface({ riskScore: 3 }), cfg);
    expect(out.strategies).toEqual([]);
    expect(out.notifyHuman).toBe(false);
  });

  it('dispatches exploratory once the risk score meets the threshold', () => {
    const out = dispatchAgents(fixtureChangeSurface({ riskScore: 4 }), cfg);
    expect(out.strategies).toEqual(['exploratory']);
    expect(out.notifyHuman).toBe(false);
  });

  it('adds generative once the risk score exceeds 5', () => {
    const out = dispatchAgents(fixtureChangeSurface({ riskScore: 6 }), cfg);
    expect(out.strategies).toEqual(['exploratory', 'generative']);
    expect(out.notifyHuman).toBe(false);
  });

  it('notifies a human at a risk score of 7 or above', () => {
    const out = dispatchAgents(fixtureChangeSurface({ riskScore: 7 }), cfg);
    expect(out.strategies).toEqual(['exploratory', 'generative']);
    expect(out.notifyHuman).toBe(true);
  });

  it('honors a custom exploratory risk threshold', () => {
    const custom = defineConfig({ tiers: { aiExploratory: { riskThreshold: 8 } } });
    const out = dispatchAgents(fixtureChangeSurface({ riskScore: 5 }), custom);
    expect(out.strategies).not.toContain('exploratory');
  });
});
