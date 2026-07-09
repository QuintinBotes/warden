import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, loadConfig } from './config';

describe('defineConfig', () => {
  it('fills documented defaults from an empty config', () => {
    const cfg = defineConfig({});
    expect(cfg.ai.provider).toBe('anthropic');
    expect(cfg.browser.engine).toBe('playwright');
    expect(cfg.browser.headless).toBe(true);
    expect(cfg.gates.blockOnPassRateBelowPercent).toBe(90);
    expect(cfg.gates.flakeQuarantineAfterRuns).toBe(3);
    expect(cfg.reporting.ctrf).toBe(true);
    expect(cfg.testManagement.testCasesDir).toBe('tests/cases/');
    expect(cfg.scope.sharedPaths).toContain('packages/core/');
    expect(cfg.plugins).toEqual([]);
  });

  it('merges overrides while keeping every other default', () => {
    const cfg = defineConfig({ ai: { provider: 'ollama' }, browser: { headless: false } });
    expect(cfg.ai.provider).toBe('ollama');
    expect(cfg.ai.ollama.baseUrl).toBe('http://localhost:11434');
    expect(cfg.browser.headless).toBe(false);
    expect(cfg.browser.engine).toBe('playwright');
  });

  it('rejects an unknown provider', () => {
    // @ts-expect-error — 'bard' is not a valid provider
    expect(() => defineConfig({ ai: { provider: 'bard' } })).toThrow();
  });

  it('defaults the additive cuj block to OFF while filling gate/signal defaults', () => {
    const cfg = defineConfig({});
    expect(cfg.cuj.enabled).toBe(false); // opt-in feature defaults OFF
    expect(cfg.cuj.dir).toBe('.warden/cuj/');
    expect(cfg.cuj.gate.enabled).toBe(true); // gate only fires for touched CUJs
    expect(cfg.cuj.gate.blockOnBroken).toBe(true);
    expect(cfg.cuj.gate.blockTier1OnDegrade).toBe(true);
    expect(cfg.cuj.gate.warnTier2OnDegrade).toBe(true);
    expect(cfg.cuj.signals).toEqual({ a11y: false, perf: false, visual: false });
    expect(cfg.cuj.exploratory.missionBriefTier).toBe('tier1');
  });

  it('defaults the additive traffic block to OFF while filling scrub/retention/clustering defaults', () => {
    const cfg = defineConfig({});
    expect(cfg.traffic.enabled).toBe(false); // opt-in feature defaults OFF
    expect(cfg.traffic.source).toBe('browser-sdk');
    expect(cfg.traffic.sampleRate).toBe(0.01);
    expect(cfg.traffic.consent.required).toBe(true);
    expect(cfg.traffic.consent.honorDoNotTrack).toBe(true);
    expect(cfg.traffic.pii.redactionToken).toBe('[REDACTED]');
    expect(cfg.traffic.pii.extraRules).toEqual([]);
    expect(cfg.traffic.pii.selectorAllowlist).toContain('Search');
    expect(cfg.traffic.retention.storeRawAfterScrub).toBe(false); // never persist unscrubbed capture
    expect(cfg.traffic.retention.scrubbedTtlDays).toBe(30);
    expect(cfg.traffic.clustering.minSessions).toBe(5);
    expect(cfg.traffic.clustering.topClusters).toBe(20);
    expect(cfg.traffic.synthesis.minClusterFrequency).toBe(10);
    expect(cfg.traffic.synthesis.proposeCujs).toBe(true);
    expect(cfg.traffic.synthesis.outDir).toBe('tests/e2e/traffic/');
  });

  it('defaults the additive impact block to OFF with a run-all safety net', () => {
    const cfg = defineConfig({});
    expect(cfg.impact.enabled).toBe(false); // opt-in feature defaults OFF
    expect(cfg.impact.indexPath).toBe('warden-coverage-index.json');
    expect(cfg.impact.onUncovered).toBe('run-all'); // a brand-new file is never silently skipped
  });

  it('accepts an opt-in impact config while keeping other defaults', () => {
    const cfg = defineConfig({ impact: { enabled: true, onUncovered: 'warn' } });
    expect(cfg.impact.enabled).toBe(true);
    expect(cfg.impact.onUncovered).toBe('warn');
    expect(cfg.impact.indexPath).toBe('warden-coverage-index.json'); // default kept
  });

  it('defaults the additive enterprise block to auth-optional (mode none, audit off)', () => {
    const cfg = defineConfig({});
    expect(cfg.enterprise.auth.mode).toBe('none'); // self-hosted OSS default: no auth
    expect(cfg.enterprise.auth.requiredRoleForGateOverride).toBe('maintainer');
    expect(cfg.enterprise.auth.requiredRoleForSuggestionMerge).toBe('maintainer');
    expect(cfg.enterprise.auth.requiredRoleForRoleChange).toBe('admin');
    expect(cfg.enterprise.audit.enabled).toBe(false); // no audit records kept by default
    expect(cfg.enterprise.audit.retentionDays).toBe(400);
    expect(cfg.enterprise.dataHandling.piiScrubbing).toBe(true);
    expect(cfg.enterprise.dataHandling.executionHistoryRetentionDays).toBe(400);
  });

  it('accepts an opt-in oidc enterprise config while keeping other defaults', () => {
    const cfg = defineConfig({
      enterprise: { auth: { mode: 'oidc' }, audit: { enabled: true, retentionDays: 90 } },
    });
    expect(cfg.enterprise.auth.mode).toBe('oidc');
    expect(cfg.enterprise.auth.requiredRoleForGateOverride).toBe('maintainer'); // default kept
    expect(cfg.enterprise.audit.enabled).toBe(true);
    expect(cfg.enterprise.audit.retentionDays).toBe(90);
  });
});

describe('loadConfig', () => {
  it('resolves a warden.config.ts and applies defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'warden-cfg-'));
    try {
      await writeFile(
        join(dir, 'warden.config.ts'),
        'export default { browser: { headless: false }, gates: { blockOnPassRateBelowPercent: 80 } };\n',
      );
      const cfg = await loadConfig(dir);
      expect(cfg.browser.headless).toBe(false);
      expect(cfg.gates.blockOnPassRateBelowPercent).toBe(80);
      expect(cfg.ai.provider).toBe('anthropic'); // default still applied
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
