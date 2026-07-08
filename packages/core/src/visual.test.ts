import { describe, it, expect } from 'vitest';
import { defineConfig } from './config';
import type { VisualCheck, VisualComparison, VisualFinding } from './visual';
import type { PluginHookEvent } from './plugin';
import type { ImagePart } from './llm';

describe('visual config', () => {
  it('defaults to disabled with a sensible matrix', () => {
    const cfg = defineConfig({});
    expect(cfg.visual.enabled).toBe(false);
    expect(cfg.visual.mode).toBe('pixel');
    expect(cfg.visual.viewports.map((v) => v.name)).toEqual(['desktop', 'mobile']);
    expect(cfg.visual.themes).toEqual(['light']);
    expect(cfg.visual.gate).toBe('warn');
  });

  it('accepts an ai-mode override', () => {
    const cfg = defineConfig({ visual: { enabled: true, mode: 'ai', gate: 'block' } });
    expect(cfg.visual.enabled).toBe(true);
    expect(cfg.visual.mode).toBe('ai');
    expect(cfg.visual.gate).toBe('block');
    // untouched keys still fall back to defaults
    expect(cfg.visual.maxChecks).toBe(200);
  });
});

describe('visual types', () => {
  it('models a check, a VISUAL_DIFF comparison, and a finding', () => {
    const check: VisualCheck = {
      module: 'apps/checkout',
      url: 'http://preview/checkout',
      viewport: { name: 'desktop', width: 1280, height: 720 },
      theme: 'light',
    };
    const comparison: VisualComparison = {
      check,
      status: 'VISUAL_DIFF',
      changedRatio: 0.12,
      candidatePath: 'artifacts/checkout-desktop-light.png',
    };
    const finding: VisualFinding = {
      module: 'apps/checkout',
      viewport: 'desktop',
      theme: 'light',
      severity: 'HIGH',
      changedRatio: 0.12,
      candidatePath: comparison.candidatePath,
    };
    expect(comparison.status).toBe('VISUAL_DIFF');
    expect(finding.severity).toBe('HIGH');
  });

  it('models an image part for vision input', () => {
    const img: ImagePart = { mimeType: 'image/png', dataBase64: 'iVBOR' };
    expect(img.mimeType).toBe('image/png');
  });
});

describe('plugin hook events', () => {
  it('models the discriminated union', () => {
    const events: PluginHookEvent[] = [
      {
        hook: 'onGateDecision',
        decision: { decision: 'BLOCK', reason: 'visual regression on checkout' } as never,
      },
    ];
    expect(events[0]?.hook).toBe('onGateDecision');
  });
});
