import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import {
  findMissingTranslations,
  i18nResultsToCtrf,
  evaluateI18nGate,
  type LocaleMap,
} from './i18n';

const locales: LocaleMap = {
  en: {
    'checkout.title': 'Checkout',
    'checkout.cta': 'Pay now',
    'checkout.legal': '',
    'debug.placeholder': 'internal only',
  },
  fr: {
    'checkout.title': 'Paiement',
    // checkout.cta missing entirely
    'checkout.legal': '',
    'debug.placeholder': '',
  },
  de: {
    'checkout.title': 'Kasse',
    'checkout.cta': 'Jetzt bezahlen',
    'checkout.legal': '',
    'debug.placeholder': 'nur intern',
  },
};

describe('findMissingTranslations', () => {
  it('finds a key missing entirely from a non-default locale', () => {
    const missing = findMissingTranslations(locales, { defaultLocale: 'en', ignoreKeys: [] });
    expect(missing).toContainEqual({ locale: 'fr', key: 'checkout.cta' });
  });

  it('does not flag keys that are empty in the default locale itself', () => {
    const missing = findMissingTranslations(locales, { defaultLocale: 'en', ignoreKeys: [] });
    expect(missing.some((m) => m.key === 'checkout.legal')).toBe(false);
  });

  it('ignoreKeys suppresses a key from the diff', () => {
    const missing = findMissingTranslations(locales, {
      defaultLocale: 'en',
      ignoreKeys: ['debug.placeholder'],
    });
    expect(missing.some((m) => m.key === 'debug.placeholder')).toBe(false);
  });

  it('flags an empty (present-but-blank) translation as missing without ignoreKeys', () => {
    const missing = findMissingTranslations(locales, { defaultLocale: 'en', ignoreKeys: [] });
    expect(missing).toContainEqual({ locale: 'fr', key: 'debug.placeholder' });
  });

  it('a fully-translated locale contributes no findings', () => {
    const missing = findMissingTranslations(locales, { defaultLocale: 'en', ignoreKeys: [] });
    expect(missing.some((m) => m.locale === 'de')).toBe(false);
  });

  it('never compares the default locale against itself', () => {
    const missing = findMissingTranslations(locales, { defaultLocale: 'en', ignoreKeys: [] });
    expect(missing.some((m) => m.locale === 'en')).toBe(false);
  });

  it('returns nothing when the default locale is absent from the map', () => {
    const missing = findMissingTranslations(
      { fr: { a: 'x' } },
      { defaultLocale: 'en', ignoreKeys: [] },
    );
    expect(missing).toEqual([]);
  });
});

describe('i18nResultsToCtrf', () => {
  const missing = findMissingTranslations(locales, { defaultLocale: 'en', ignoreKeys: [] });

  it('produces a CTRFReportSchema-valid report', () => {
    const report = i18nResultsToCtrf(missing);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool to warden-i18n', () => {
    expect(i18nResultsToCtrf(missing).results.tool.name).toBe('warden-i18n');
  });

  it('emits one failed test per (locale, missing key) with locale/key in extra', () => {
    const report = i18nResultsToCtrf(missing);
    expect(report.results.tests).toHaveLength(missing.length);
    const ctaTest = report.results.tests.find((t) => t.name === 'fr: checkout.cta');
    expect(ctaTest?.status).toBe('failed');
    expect(ctaTest?.extra).toMatchObject({ locale: 'fr', key: 'checkout.cta' });
  });

  it('returns an empty report for no missing translations', () => {
    const report = i18nResultsToCtrf([]);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
    expect(report.results.tests).toHaveLength(0);
    expect(report.results.summary).toMatchObject({ tests: 0, passed: 0, failed: 0 });
  });
});

describe('evaluateI18nGate', () => {
  const missing = findMissingTranslations(locales, { defaultLocale: 'en', ignoreKeys: [] });
  const report = i18nResultsToCtrf(missing);
  const emptyReport = i18nResultsToCtrf([]);

  it('WARNs by default (gate: "warn") when missing translations are found', () => {
    const gate = evaluateI18nGate(report, { gate: 'warn' });
    expect(gate.decision).toBe('WARN');
  });

  it('BLOCKs when gate is "block" and missing translations are found', () => {
    const gate = evaluateI18nGate(report, { gate: 'block' });
    expect(gate.decision).toBe('BLOCK');
  });

  it('PASSes when gate is "off", even with missing translations', () => {
    const gate = evaluateI18nGate(report, { gate: 'off' });
    expect(gate.decision).toBe('PASS');
  });

  it('PASSes when there are no missing translations, regardless of gate severity', () => {
    expect(evaluateI18nGate(emptyReport, { gate: 'warn' }).decision).toBe('PASS');
    expect(evaluateI18nGate(emptyReport, { gate: 'block' }).decision).toBe('PASS');
  });

  it('WARNs when the check compared no locales (measurement gap, not a clean bill)', () => {
    const gate = evaluateI18nGate(emptyReport, { gate: 'warn' }, { comparedLocaleCount: 0 });
    expect(gate.decision).toBe('WARN');
    expect(gate.reason).toMatch(/no locales|nothing was measured/i);
  });

  it('PASSes when locales were compared and nothing is missing', () => {
    expect(
      evaluateI18nGate(emptyReport, { gate: 'warn' }, { comparedLocaleCount: 2 }).decision,
    ).toBe('PASS');
  });
});
