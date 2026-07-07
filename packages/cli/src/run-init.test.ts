import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './run-init';

describe('runInit', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'warden-cli-init-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('scaffolds an import-free warden.config.ts that loads without deps installed', async () => {
    const result = await runInit({ cwd: dir });

    expect(result.configPath).toBe(path.join(dir, 'warden.config.ts'));
    const config = await fs.readFile(result.configPath, 'utf-8');
    // Import-free so `npx warden` works before @warden/core is resolvable:
    // no real top-level import statement (the JSDoc may mention one as an example).
    expect(config).not.toMatch(/^import /m);
    expect(config).toContain('export default {');
    expect(config).toContain("provider: 'anthropic'");
    expect(config).toContain('WardenConfigInput'); // JSDoc type for editor support
  });

  it('scaffolds a sample .github/workflows/ai-qa.yml', async () => {
    const result = await runInit({ cwd: dir });

    expect(result.workflowPath).toBe(path.join(dir, '.github', 'workflows', 'ai-qa.yml'));
    const workflow = await fs.readFile(result.workflowPath, 'utf-8');
    expect(workflow).toContain('warden analyze');
    expect(workflow).toContain('warden run');
    expect(workflow).toContain('pull_request');
  });

  it('creates the .github/workflows directory tree', async () => {
    await runInit({ cwd: dir });
    const stat = await fs.stat(path.join(dir, '.github', 'workflows'));
    expect(stat.isDirectory()).toBe(true);
  });
});
