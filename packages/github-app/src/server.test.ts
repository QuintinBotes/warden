import { describe, expect, it } from 'vitest';
import { ConfigError, type FileAccess } from '@warden/core';
import { loadRepoConfig } from './server.js';

/** A `FileAccess` whose `readFile` answers with one canned body (or `null` for a 404). */
function fileAccessReturning(body: string | null): FileAccess {
  return {
    listFiles: () => Promise.resolve([]),
    readFile: () => Promise.resolve(body),
  };
}

describe('loadRepoConfig', () => {
  it('reports a repository with no warden.config as unconfigured, not as configured defaults', async () => {
    const warnings: string[] = [];
    const loaded = await loadRepoConfig('warden.config.json', fileAccessReturning(null), (m) =>
      warnings.push(m),
    );

    expect(loaded.configured).toBe(false);
    expect(loaded.config.ai.provider).toBe('anthropic'); // defaults still filled
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no warden\.config/i);
  });

  it('reports a repository that has a warden.config as configured', async () => {
    const warnings: string[] = [];
    const loaded = await loadRepoConfig(
      'warden.config.json',
      fileAccessReturning('{"browser":{"headless":false}}'),
      (m) => warnings.push(m),
    );

    expect(loaded.configured).toBe(true);
    expect(loaded.config.browser.headless).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('refuses a warden.config it cannot parse rather than running with defaults', async () => {
    // Silently substituting defaults for a broken config runs the whole pipeline against settings
    // the repository never wrote, and says nothing about it.
    await expect(
      loadRepoConfig('warden.config.json', fileAccessReturning('{ not json'), () => {}),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('refuses a warden.config that does not match the schema', async () => {
    await expect(
      loadRepoConfig(
        'warden.config.json',
        fileAccessReturning('{"ai":{"provider":"telepathy"}}'),
        () => {},
      ),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
