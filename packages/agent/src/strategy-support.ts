import type { ChangeSurface, DiffFile, Severity } from '@warden/core';

/** Narrows an unknown value (typically a tool-call input) to a string-keyed record. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

const SEVERITIES: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** Coerces an arbitrary value to a valid {@link Severity}, defaulting to `MEDIUM`. */
export function normalizeSeverity(value: unknown, fallback: Severity = 'MEDIUM'): Severity {
  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    const match = SEVERITIES.find((s) => s === upper);
    if (match) return match;
  }
  return fallback;
}

/** Coerces an arbitrary value to a non-empty `string[]` of steps. */
export function normalizeSteps(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((step) => String(step)).filter((step) => step.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

/** `slugify('apps/checkout')` → `'checkout'`; `slugify('src/Login-Form.tsx')` → `'login-form'`. */
export function slugify(input: string): string {
  const base = input.split('/').filter(Boolean).pop() ?? input;
  const withoutExt = base.replace(/\.[^.]+$/, '');
  const slug = withoutExt
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'change';
}

/** Picks a human/feature name for the change under test from the available signals. */
export function featureName(changeSurface?: ChangeSurface, diff?: DiffFile[]): string {
  const fromModule = changeSurface?.changedModules?.[0];
  if (fromModule) return slugify(fromModule);
  const fromFile = changeSurface?.changedFiles?.[0] ?? diff?.[0]?.path;
  if (fromFile) return slugify(fromFile);
  return 'change';
}

/** Renders a compact textual summary of the change for inclusion in a prompt. */
export function summarizeChange(changeSurface?: ChangeSurface, diff?: DiffFile[]): string {
  const lines: string[] = [];
  if (changeSurface) {
    lines.push(`Changed modules: ${changeSurface.changedModules.join(', ') || '(none)'}`);
    lines.push(`Changed files: ${changeSurface.changedFiles.join(', ') || '(none)'}`);
    lines.push(`Risk score: ${changeSurface.riskScore}/10`);
    if (changeSurface.affectedApiRoutes.length > 0) {
      lines.push(`Affected API routes: ${changeSurface.affectedApiRoutes.join(', ')}`);
    }
  }
  if (diff && diff.length > 0) {
    lines.push('Diff files:');
    for (const file of diff) {
      lines.push(`  - ${file.status} ${file.path}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No structured change information was provided.';
}
