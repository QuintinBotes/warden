#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildProgram } from '../program.js';

/** Reads the CLI version from this package's own package.json (never goes stale on a release). */
function resolveVersion(): string {
  try {
    // From dist/bin/warden.js, package.json sits two levels up (packages/cli/package.json).
    // Resolved here rather than in `program.ts` because that module is bundled into a shared
    // chunk at the root of `dist/`, where the same relative path points somewhere else.
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

await buildProgram({ version: resolveVersion() }).parseAsync(process.argv);
