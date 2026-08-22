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

try {
  await buildProgram({ version: resolveVersion() }).parseAsync(process.argv);
} catch (err) {
  // A failure the program already reported has been printed as one clean sentence; letting it
  // escape here would print it again as an uncaught rejection with a stack, which is the noise
  // a reader has to scroll past to find the sentence. Anything NOT already reported is a bug in
  // Warden rather than a diagnosed condition, so it keeps its stack — that is the case where the
  // stack is the whole of the information. WARDEN_DEBUG=1 keeps it in both.
  const reported =
    err instanceof Error && (err as Error & { wardenReported?: true }).wardenReported;
  if (!reported || process.env.WARDEN_DEBUG) throw err;
  process.exitCode = process.exitCode ?? 1;
}
