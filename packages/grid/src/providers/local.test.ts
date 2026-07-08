import { describe, expect, it } from 'vitest';
import { BrowserError, type GridConfig } from '@warden/core';
import { expandMatrix } from '@warden/runner';
import { LocalGridProvider } from './local';

function gridConfig(over: Partial<GridConfig> = {}): GridConfig {
  return {
    enabled: false,
    provider: 'local',
    maxShards: 1,
    balanceBy: 'duration',
    matrix: { browsers: ['chromium'], devices: [] },
    ...over,
  };
}

const launchOpts = { headless: true, viewport: { width: 1280, height: 720 }, timeout: 30000 };

describe('LocalGridProvider', () => {
  it('is named local and needs no network client', () => {
    expect(new LocalGridProvider(gridConfig()).name).toBe('local');
  });

  it('maps the matrix to lanes whose ids equal expandMatrix output', async () => {
    const provider = new LocalGridProvider(gridConfig());
    const caps = await provider.capabilities({ browsers: ['chromium', 'webkit'] });
    const projects = expandMatrix({ browsers: ['chromium', 'webkit'] });
    expect(caps.map((c) => c.id)).toEqual(projects.map((p) => `local:${p}`));
    expect(caps.every((c) => c.real === false)).toBe(true);
    expect(caps.map((c) => c.browser)).toEqual(['chromium', 'webkit']);
  });

  it('crosses browsers with device labels, matching expandMatrix', async () => {
    const provider = new LocalGridProvider(gridConfig());
    const caps = await provider.capabilities({
      browsers: ['chromium'],
      devices: ['desktop', 'mobile'],
    });
    const projects = expandMatrix({ browsers: ['chromium'], devices: ['desktop', 'mobile'] });
    expect(caps.map((c) => c.id)).toEqual(projects.map((p) => `local:${p}`));
    expect(caps.map((c) => c.device)).toEqual(['desktop', 'mobile']);
  });

  it('rejects a non-local browser via expandMatrix validation', async () => {
    const provider = new LocalGridProvider(gridConfig());
    await expect(provider.capabilities({ browsers: ['safari'] })).rejects.toBeInstanceOf(
      BrowserError,
    );
  });

  it('openSession returns a local endpoint with no network', async () => {
    const provider = new LocalGridProvider(gridConfig());
    const [cap] = await provider.capabilities({ browsers: ['chromium'] });
    const info = await provider.openSession(cap!, launchOpts);
    expect(info.endpoint).toBe('local://local:chromium');
    expect(info.sessionId).toBe('local-local:chromium');
    expect(info.capability).toEqual(cap);
  });

  it('closeSession resolves as a no-op', async () => {
    const provider = new LocalGridProvider(gridConfig());
    const [cap] = await provider.capabilities({ browsers: ['chromium'] });
    const info = await provider.openSession(cap!, launchOpts);
    await expect(provider.closeSession(info, 'passed')).resolves.toBeUndefined();
  });
});
