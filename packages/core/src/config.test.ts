import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, loadConfig, loadConfigWithSource } from './config';

describe('defineConfig', () => {
  it('fills documented defaults from an empty config', () => {
    const cfg = defineConfig({});
    expect(cfg.ai.provider).toBe('anthropic');
    expect(cfg.browser.engine).toBe('playwright');
    expect(cfg.browser.headless).toBe(true);
    // 100, not 90: the gate requires every executed test to pass unless a repo lowers this.
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

describe('loadConfig treats the config file as untrusted input', () => {
  // On CI the config file is the pull request's copy, and the process reading it holds
  // ANTHROPIC_API_KEY. These are the two things it must not be able to do.
  const withTempDir = async (body: (dir: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), 'warden-cfg-'));
    try {
      await body(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it('never executes the config file: a side effect in it does not happen', async () => {
    await withTempDir(async (dir) => {
      const sentinel = join(dir, 'CONFIG_EXECUTED');
      await writeFile(
        join(dir, 'warden.config.ts'),
        `import { writeFileSync } from 'node:fs';\n` +
          `writeFileSync(${JSON.stringify(sentinel)}, 'pwned');\n` +
          `export default {};\n`,
      );
      await expect(loadConfig(dir)).rejects.toThrow(/never executes it/);
      await expect(stat(sentinel)).rejects.toThrow(); // the file was never written
    });
  });

  it('refuses a config that points the model at a host that is not this machine', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'warden.config.ts'),
        `export default { ai: { provider: 'ollama', ollama: { baseUrl: 'https://attacker.example' } } };\n`,
      );
      await expect(loadConfig(dir)).rejects.toThrow(/will not send model prompts/);
    });
  });

  it('takes a remote AI endpoint from the environment, which the repository cannot write', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'warden.config.ts'), `export default { ai: {} };\n`);
      process.env.WARDEN_OLLAMA_BASE_URL = 'https://ollama.internal.example';
      try {
        const cfg = await loadConfig(dir);
        expect(cfg.ai.ollama.baseUrl).toBe('https://ollama.internal.example');
      } finally {
        delete process.env.WARDEN_OLLAMA_BASE_URL;
      }
    });
  });

  it('executes the file only when the operator vouches for the checkout', async () => {
    await withTempDir(async (dir) => {
      const sentinel = join(dir, 'CONFIG_EXECUTED');
      await writeFile(
        join(dir, 'warden.config.ts'),
        `import { writeFileSync } from 'node:fs';\n` +
          `writeFileSync(${JSON.stringify(sentinel)}, 'ran');\n` +
          `export default { gates: { blockOnPassRateBelowPercent: 70 } };\n`,
      );
      const cfg = await loadConfig(dir, { trust: true });
      expect(cfg.gates.blockOnPassRateBelowPercent).toBe(70);
      expect((await readFile(sentinel, 'utf-8')).trim()).toBe('ran'); // opt-in really does run it
    });
  });

  it('reads the documented defineConfig() form, imports and all', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'warden.config.ts'),
        `import { defineConfig } from '@warden/core';\n\n` +
          `// A comment, and a trailing comma.\n` +
          `export default defineConfig({\n` +
          `  ai: { provider: 'ollama', model: 'qwen3:32b' },\n` +
          `  scope: { sharedPaths: ['lib/'] },\n` +
          `});\n`,
      );
      const cfg = await loadConfig(dir);
      expect(cfg.ai.provider).toBe('ollama');
      expect(cfg.scope.sharedPaths).toEqual(['lib/']);
      expect(cfg.ai.ollama.baseUrl).toBe('http://localhost:11434'); // default still applied
    });
  });

  it('merges warden.config.local.* over warden.config.*', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'warden.config.ts'),
        `export default { browser: { engine: 'playwright', headless: true } };\n`,
      );
      await writeFile(
        join(dir, 'warden.config.local.ts'),
        `export default { browser: { headless: false } };\n`,
      );
      const cfg = await loadConfig(dir);
      expect(cfg.browser.headless).toBe(false);
      expect(cfg.browser.engine).toBe('playwright'); // untouched key survives the overlay
    });
  });

  it('reads warden.config.json', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'warden.config.json'), '{ "gates": { "warnOnHighCount": 5 } }');
      const cfg = await loadConfig(dir);
      expect(cfg.gates.warnOnHighCount).toBe(5);
    });
  });

  it('falls back to defaults when the repo has no config at all', async () => {
    await withTempDir(async (dir) => {
      const cfg = await loadConfig(dir);
      expect(cfg.ai.provider).toBe('anthropic');
    });
  });
});

describe('ai.ollama.baseUrl', () => {
  it('rejects a value that is not an http(s) URL', () => {
    expect(() => defineConfig({ ai: { ollama: { baseUrl: 'file:///etc/passwd' } } })).toThrow();
    expect(() => defineConfig({ ai: { ollama: { baseUrl: 'not a url' } } })).toThrow();
  });

  it('accepts a remote https endpoint when the config is written by hand', () => {
    // `defineConfig` is the author's own call in their own process; the loopback rule belongs to
    // `loadConfig`, which is the path that reads a file it did not write.
    const cfg = defineConfig({ ai: { ollama: { baseUrl: 'https://ollama.internal.example' } } });
    expect(cfg.ai.ollama.baseUrl).toBe('https://ollama.internal.example');
  });
});

describe('loadConfigWithSource', () => {
  it('reports a repository with no warden.config as unconfigured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'warden-cfg-absent-'));
    try {
      const loaded = await loadConfigWithSource(dir);
      expect(loaded.configured).toBe(false);
      expect(loaded.sourcePath).toBeNull();
      // The defaults are still filled — the caller gets a usable config, just an unconfigured one.
      expect(loaded.config.ai.provider).toBe('anthropic');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('tells an absent config apart from a present-but-empty one, whose values are identical', async () => {
    const absent = await mkdtemp(join(tmpdir(), 'warden-cfg-absent-'));
    const empty = await mkdtemp(join(tmpdir(), 'warden-cfg-empty-'));
    try {
      await writeFile(join(empty, 'warden.config.ts'), 'export default {};\n');

      const a = await loadConfigWithSource(absent);
      const b = await loadConfigWithSource(empty);

      // The two configs really are value-identical: provenance is the only thing that separates
      // "this repository chose the defaults" from "nobody ever configured this repository".
      expect(a.config).toEqual(b.config);
      expect(a.configured).toBe(false);
      expect(b.configured).toBe(true);
      expect(b.sourcePath).toMatch(/warden\.config\.ts$/);
    } finally {
      await rm(absent, { recursive: true, force: true });
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('does not count a .wardenrc, because the non-executing loader never reads one', async () => {
    // `.wardenrc` was only ever resolved by c12. Reading the config as data instead of running
    // it dropped that lookup, so a repo configured only that way is genuinely unconfigured as
    // far as this loader is concerned — and saying `configured: true` would be the exact
    // false claim this function exists to prevent.
    const dir = await mkdtemp(join(tmpdir(), 'warden-cfg-rc-'));
    try {
      await writeFile(join(dir, '.wardenrc'), 'scope.tagPrefix=#\n');
      const loaded = await loadConfigWithSource(dir);
      expect(loaded.configured).toBe(false);
      expect(loaded.sourcePath).toBeNull();
      expect(loaded.config.scope.tagPrefix).not.toBe('#');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
