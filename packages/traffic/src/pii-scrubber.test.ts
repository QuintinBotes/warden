import { describe, expect, it } from 'vitest';
import type { PiiRule, RawTrafficSession } from '@warden/core';
import { defaultPiiScrubber, luhnValid } from './pii-scrubber.js';
import { ALL_PII, PII, piiLadenRawSession, rawSession } from './testing-fakes.js';

const TOKEN = '[REDACTED]';

/** Every string field across the scrubbed session, for leak assertions. */
function allText(session: { url: string; steps: { selector?: string; value?: string }[] }): string {
  return JSON.stringify(session);
}

describe('defaultPiiScrubber', () => {
  it('redacts email / PAN / SSN / JWT / bearer / uuid in values and URLs', () => {
    const scrubber = defaultPiiScrubber({
      redactionToken: TOKEN,
      selectorAllowlist: ['Email', 'Card number', 'SSN', 'Token', 'Search'],
    });
    const scrubbed = scrubber.scrub(piiLadenRawSession());
    const text = allText(scrubbed);
    for (const pii of ALL_PII) {
      expect(text).not.toContain(pii);
    }
  });

  it('the load-bearing property: no raw PII survives in the scrubbed session', () => {
    const scrubber = defaultPiiScrubber({ redactionToken: TOKEN });
    const scrubbed = scrubber.scrub(piiLadenRawSession());
    const text = allText(scrubbed);
    expect(text).toContain(TOKEN);
    for (const pii of ALL_PII) {
      expect(text).not.toContain(pii);
    }
  });

  it('keeps allowlisted selector labels verbatim and redacts every other selector (allowlist model)', () => {
    const scrubber = defaultPiiScrubber({
      redactionToken: TOKEN,
      selectorAllowlist: ['Search', 'Quantity'],
    });
    const session = rawSession({
      steps: [
        { action: 'click', selector: 'Search', value: 'shoes' },
        { action: 'click', selector: 'Add to cart' }, // not allowlisted → redacted
        { action: 'note', selector: PII.email }, // PII selector, not allowlisted → redacted
      ],
    });
    const scrubbed = scrubber.scrub(session);
    expect(scrubbed.steps[0]!.selector).toBe('Search'); // allowlisted survives
    expect(scrubbed.steps[1]!.selector).toBe(TOKEN); // non-allowlisted redacted whole
    expect(scrubbed.steps[2]!.selector).toBe(TOKEN); // PII selector redacted
    expect(allText(scrubbed)).not.toContain(PII.email);
  });

  it('redacts a Luhn-valid PAN (with separators) but leaves short numerics alone', () => {
    const scrubber = defaultPiiScrubber({ redactionToken: TOKEN });
    const valid = scrubber.scrub(
      rawSession({ steps: [{ action: 'fill', value: 'card 4111 1111 1111 1111 ok' }] }),
    );
    expect(valid.steps[0]!.value).not.toContain('4111');
    expect(valid.steps[0]!.value).toContain(TOKEN);

    // A short order number is not PII-shaped and survives.
    const kept = scrubber.scrub(rawSession({ steps: [{ action: 'fill', value: 'order #1000' }] }));
    expect(kept.steps[0]!.value).toContain('1000');
  });

  it('fails closed: a rule that throws redacts the whole value rather than leaking it', () => {
    // A rule whose `source` getter throws when the scrubber compiles it.
    const boom = /placeholder/;
    Object.defineProperty(boom, 'source', {
      get() {
        throw new Error('boom');
      },
    });
    const throwingRule = {
      name: 'boom',
      pattern: boom,
      applyTo: 'value',
    } as unknown as PiiRule;

    const scrubber = defaultPiiScrubber({ redactionToken: TOKEN, extraRules: [throwingRule] });
    const scrubbed = scrubber.scrub(
      rawSession({ steps: [{ action: 'fill', value: 'totally benign text' }] }),
    );
    expect(scrubbed.steps[0]!.value).toBe(TOKEN); // whole value redacted, not passed through
    expect(scrubbed.steps[0]!.value).not.toContain('benign');
  });

  it('applies configured extra value rules', () => {
    const scrubber = defaultPiiScrubber({
      redactionToken: TOKEN,
      extraRules: [{ name: 'internal-id', pattern: /EMP-\d{5}/g, applyTo: 'value' }],
    });
    const scrubbed = scrubber.scrub(
      rawSession({ steps: [{ action: 'fill', value: 'employee EMP-01234 here' }] }),
    );
    expect(scrubbed.steps[0]!.value).not.toContain('EMP-01234');
    expect(scrubbed.steps[0]!.value).toContain(TOKEN);
  });

  it('reports the redaction count via scrubWithReport', () => {
    const scrubber = defaultPiiScrubber({ redactionToken: TOKEN, selectorAllowlist: ['Search'] });
    const { redactions } = scrubber.scrubWithReport(piiLadenRawSession());
    expect(redactions).toBeGreaterThan(0);
  });

  it('drops the raw session envelope (anonId / consent) from the scrubbed output', () => {
    const scrubber = defaultPiiScrubber({ redactionToken: TOKEN });
    const scrubbed = scrubber.scrub(rawSession()) as Partial<RawTrafficSession>;
    expect(scrubbed.anonId).toBeUndefined();
    expect(scrubbed.consent).toBeUndefined();
  });
});

describe('luhnValid', () => {
  it('accepts known-valid test PANs and rejects invalid ones', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('5555555555554444')).toBe(true);
    expect(luhnValid('1234567812345678')).toBe(false);
    expect(luhnValid('123')).toBe(false); // too short
  });
});
