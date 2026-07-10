import { CTRFReportSchema, type CTRFReport, type CTRFTest, type GateDecision } from '@warden/core';

/**
 * i18n content-check glue, shaped exactly like `perf/k6.ts` / `security/zap.ts` / `a11y/axe.ts`:
 * the pure diff helper {@link findMissingTranslations}, the pure converter {@link i18nResultsToCtrf}
 * (missing translations → CTRF), and the pure gate helper {@link evaluateI18nGate} are unit-tested;
 * {@link readLocales}, which reads locale JSON files via an injected file reader, is integration-only
 * and not unit-tested. Unlike the other tiers this one is entirely file-based — there is no external
 * tool binary to shell out to.
 */

/** A flattened locale: dot-notated key → string value, e.g. `{ 'checkout.title': 'Checkout' }`. */
export type FlatLocale = Record<string, string>;

/** Locale code (e.g. `'en'`, `'fr'`) → its flattened key/value translations. */
export type LocaleMap = Record<string, FlatLocale>;

/** One missing (or empty) translation: `key` exists in the default locale but not in `locale`. */
export interface I18nMissingEntry {
  locale: string;
  key: string;
}

/** Injected config driving {@link findMissingTranslations} / {@link readLocales}; mirrors `cfg.i18n`. */
export interface I18nCheckConfig {
  defaultLocale: string;
  /** Keys to exclude from the missing-translation diff (e.g. placeholders intentionally unset). */
  ignoreKeys: string[];
}

/**
 * Pure diff: for every locale in `locales` other than `cfg.defaultLocale`, find the keys present
 * (non-empty) in the default locale but missing or empty in that locale. Keys in `cfg.ignoreKeys`
 * are excluded from the comparison entirely. Locales are compared in the order they appear in
 * `locales`, keys in the order they appear in the default locale.
 */
export function findMissingTranslations(
  locales: LocaleMap,
  cfg: I18nCheckConfig,
): I18nMissingEntry[] {
  const defaultLocale = locales[cfg.defaultLocale];
  if (!defaultLocale) return [];

  const ignore = new Set(cfg.ignoreKeys);
  const defaultKeys = Object.keys(defaultLocale).filter(
    (key) => !ignore.has(key) && defaultLocale[key] !== '',
  );

  const missing: I18nMissingEntry[] = [];
  for (const [locale, translations] of Object.entries(locales)) {
    if (locale === cfg.defaultLocale) continue;
    for (const key of defaultKeys) {
      const value = translations[key];
      if (value === undefined || value === '') {
        missing.push({ locale, key });
      }
    }
  }
  return missing;
}

/**
 * Pure converter from {@link findMissingTranslations}'s output to a {@link CTRFReport}. Each
 * missing/empty translation becomes one failed CTRF test, tagged with its locale and carrying
 * `locale`/`key` in `extra`. Output is validated with {@link CTRFReportSchema}.
 */
export function i18nResultsToCtrf(missing: I18nMissingEntry[]): CTRFReport {
  const tests: CTRFTest[] = missing.map(({ locale, key }) => ({
    name: `${locale}: ${key}`,
    status: 'failed',
    duration: 0,
    message: `Missing translation for "${key}" in locale "${locale}"`,
    tags: [locale, 'i18n'],
    extra: { locale, key },
  }));

  return CTRFReportSchema.parse({
    results: {
      tool: { name: 'warden-i18n' },
      summary: {
        tests: tests.length,
        passed: 0,
        failed: tests.length,
        skipped: 0,
        pending: 0,
        other: 0,
        start: 0,
        stop: 0,
      },
      tests,
    },
  });
}

/** Injected gate severity driving {@link evaluateI18nGate}; mirrors `cfg.i18n.gate`. */
export interface I18nGateConfig {
  gate: 'block' | 'warn' | 'off';
}

/**
 * Pure gate mapping over the CTRF output of {@link i18nResultsToCtrf}. i18n gaps rarely warrant
 * blocking a merge, so any missing translation → `WARN` by default; set `cfg.gate` to `'block'`
 * to treat gaps as blocking, or `'off'` to keep the check informational-only (always `PASS`).
 *
 * `findMissingTranslations` returns `[]` both when everything is translated AND when it could
 * compare nothing (the default locale wasn't loaded, or there are no other locales) — the latter
 * is a measurement gap, not a clean bill of health. Pass `measurement.comparedLocaleCount` so the
 * gate can `WARN` on that case instead of a false `PASS`.
 */
export function evaluateI18nGate(
  report: CTRFReport,
  cfg: I18nGateConfig,
  measurement?: { comparedLocaleCount: number },
): GateDecision {
  if (cfg.gate === 'off') {
    return { decision: 'PASS', reason: 'i18n gate is disabled (gate: "off")' };
  }

  if (measurement && measurement.comparedLocaleCount === 0) {
    return {
      decision: 'WARN',
      reason:
        'i18n check compared no locales (default locale missing, or no other locales to compare) — nothing was measured',
    };
  }

  const failed = report.results.tests.filter((t) => t.status === 'failed').length;
  if (failed === 0) {
    return { decision: 'PASS', reason: 'no missing translations found' };
  }

  if (cfg.gate === 'block') {
    return { decision: 'BLOCK', reason: `${failed} missing translation(s) found` };
  }
  return { decision: 'WARN', reason: `${failed} missing translation(s) found` };
}

/** Injected file access used by {@link readLocales}, so it can be driven by an in-memory fake in tests. */
export interface I18nFileAccess {
  /** List entries (file names or paths) directly under `dir`. */
  listFiles(dir: string): Promise<string[]>;
  /** Read a file's contents as text. */
  readFile(path: string): Promise<string>;
}

/** `<localesDir>` config subset {@link readLocales} needs; mirrors `cfg.i18n` minus `gate`. */
export interface ReadLocalesConfig {
  localesDir: string;
  defaultLocale: string;
  ignoreKeys: string[];
}

function localeNameFromFile(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  return base.replace(/\.json$/i, '');
}

/** Flatten a nested JSON value into dot-notated string keys, e.g. `{a:{b:'x'}}` → `{'a.b':'x'}`. */
function flatten(value: unknown, prefix = ''): FlatLocale {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const key = prefix || '';
    return key ? { [key]: value === null || value === undefined ? '' : String(value) } : {};
  }
  const out: FlatLocale = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const flatKey = prefix ? `${prefix}.${key}` : key;
    Object.assign(out, flatten(child, flatKey));
  }
  return out;
}

/**
 * Integration glue that reads and flattens every `*.json` locale file under `cfg.localesDir` via
 * the injected {@link I18nFileAccess}. NOT unit-tested (real file I/O). The file name (minus
 * `.json`) is used as the locale code, e.g. `locales/fr.json` → locale `'fr'`. Returns a
 * {@link LocaleMap} suitable for {@link findMissingTranslations}.
 */
export async function readLocales(
  cfg: ReadLocalesConfig,
  fileAccess: I18nFileAccess,
): Promise<LocaleMap> {
  const files = (await fileAccess.listFiles(cfg.localesDir)).filter((f) => /\.json$/i.test(f));

  const locales: LocaleMap = {};
  for (const file of files) {
    const path = file.includes('/') ? file : `${cfg.localesDir.replace(/\/$/, '')}/${file}`;
    const raw = await fileAccess.readFile(path);
    const json: unknown = JSON.parse(raw);
    locales[localeNameFromFile(file)] = flatten(json);
  }
  return locales;
}
