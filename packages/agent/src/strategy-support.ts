import type { ChangeSurface, DiffFile, FixtureCatalog, Severity } from '@warden/core';

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

/** Default cap (characters) for the fixture-catalog summary so it never blows the prompt budget. */
export const FIXTURE_SUMMARY_CAP = 2000;

/**
 * Renders a run-scoped {@link FixtureCatalog} as a compact, prompt-ready block: the run namespace
 * plus one line per seeded record (entity, declared key, example field values). Bounded by
 * {@link FIXTURE_SUMMARY_CAP} characters so a large catalog cannot overrun the model context.
 * Depends only on the `@warden/core` type — the agent never imports the `@warden/fixtures` runtime.
 */
export function summarizeFixtures(catalog: FixtureCatalog, maxChars = FIXTURE_SUMMARY_CAP): string {
  const header =
    `Seeded fixtures for this run (namespace ${catalog.namespace}). These records already exist in ` +
    'the target environment — prefer them over invented literals:';
  const lines = [header];
  let omitted = 0;
  for (let i = 0; i < catalog.records.length; i++) {
    const record = catalog.records[i];
    if (!record) continue;
    const fields = Object.entries(record.fields)
      .map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`)
      .join(', ');
    const line = `- ${record.entity}.${record.key}: ${fields}`;
    if ([...lines, line].join('\n').length > maxChars) {
      omitted = catalog.records.length - i;
      break;
    }
    lines.push(line);
  }
  if (omitted > 0)
    lines.push(`… (${omitted} more record(s) omitted to stay within the prompt budget)`);
  const summary = lines.join('\n');
  return summary.length > maxChars ? summary.slice(0, maxChars) : summary;
}
