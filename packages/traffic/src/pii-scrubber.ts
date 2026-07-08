import type {
  PiiRule,
  PiiScrubber,
  RawTrafficSession,
  RecordedSession,
  RecordedStep,
} from '@warden/core';

/**
 * `defaultPiiScrubber` — the mandatory, fail-closed PII scrub that runs at ingestion, before
 * anything durable is written. It is deterministic (no external state) so it is fully
 * unit-testable, and it is deliberately aggressive:
 *
 *  - **Values & URLs** are redacted by rule: every substring matching a built-in rule
 *    (email, phone, PAN/Luhn, SSN, JWT/bearer, uuid-in-url) or a configured `extraRule` is
 *    replaced with the redaction token.
 *  - **Selector names** use an **allowlist**, never a denylist: only labels on
 *    `selectorAllowlist` survive verbatim; every other selector is redacted whole. A selector
 *    label is the most likely place for accidental PII (`"Email: a@b.com"`), so unknown labels
 *    are dropped rather than trusted.
 *  - **Fail-closed:** if any rule throws (e.g. a pathological custom RegExp), the whole field is
 *    replaced with the token instead of being passed through — a leak is never preferable.
 *
 * The scrub returns a clean `RecordedSession`; the raw session's `anonId` / `consent` /
 * `routeTemplate` are dropped (they never carry PII and are not needed downstream of ingest).
 */
export interface DefaultPiiScrubberOptions {
  redactionToken?: string;
  extraRules?: PiiRule[];
  selectorAllowlist?: string[];
}

const DEFAULT_TOKEN = '[REDACTED]';

/** Built-in content rules applied to both step values and URLs. Order matters: earlier hits are
 *  already replaced with the token before later patterns run, so patterns cannot double-count. */
const BUILTIN_CONTENT_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { name: 'bearer', pattern: /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    name: 'uuid',
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  },
  { name: 'phone', pattern: /\+?\d[\d\s().-]{7,}\d/g },
];

/** Returns a fresh, global copy of `re` so `.replace` redacts every occurrence and no `lastIndex`
 *  state leaks between calls. */
function globalize(re: RegExp): RegExp {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  return new RegExp(re.source, flags);
}

/** Luhn checksum — a PAN candidate is only redacted as a card number if it passes Luhn. */
export function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Redacts Luhn-valid 13–19 digit runs (allowing space/dash separators) as PANs. */
function redactPans(text: string, token: string, onHit: () => void): string {
  return text.replace(/(?:\d[ -]?){13,19}/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (luhnValid(digits)) {
      onHit();
      return token;
    }
    return match;
  });
}

interface RedactResult {
  text: string;
  redactions: number;
}

/**
 * Redacts a value / URL string. Runs every built-in content rule, the Luhn PAN check, then the
 * configured `extraRules` for this field type. Fail-closed: any thrown rule redacts the whole
 * field.
 */
function redactContent(
  text: string,
  applyTo: 'value' | 'url',
  token: string,
  extraRules: PiiRule[],
): RedactResult {
  try {
    let out = text;
    let redactions = 0;
    const hit = () => {
      redactions += 1;
    };
    for (const rule of BUILTIN_CONTENT_RULES) {
      out = out.replace(globalize(rule.pattern), () => {
        hit();
        return token;
      });
    }
    out = redactPans(out, token, hit);
    for (const rule of extraRules) {
      if (rule.applyTo !== applyTo) continue;
      out = out.replace(globalize(rule.pattern), () => {
        hit();
        return token;
      });
    }
    return { text: out, redactions };
  } catch {
    // Fail-closed: never leak on a misbehaving rule.
    return { text: token, redactions: 1 };
  }
}

/** Allowlist scrub for a selector label. Non-allowlisted labels are redacted whole (fail-closed);
 *  allowlisted labels survive but are still checked against any `selectorName` extra rules. */
function scrubSelector(
  selector: string,
  token: string,
  allowlist: Set<string>,
  extraRules: PiiRule[],
): RedactResult {
  if (!allowlist.has(selector)) {
    return { text: token, redactions: 1 };
  }
  try {
    let out = selector;
    let redactions = 0;
    for (const rule of extraRules) {
      if (rule.applyTo !== 'selectorName') continue;
      out = out.replace(globalize(rule.pattern), () => {
        redactions += 1;
        return token;
      });
    }
    return { text: out, redactions };
  } catch {
    return { text: token, redactions: 1 };
  }
}

/** A `PiiScrubber` that also reports how many redactions it applied to the last session. The
 *  pipeline uses the interface; tests can use the richer `scrubWithReport` to assert counts. */
export interface ReportingPiiScrubber extends PiiScrubber {
  scrubWithReport(session: RawTrafficSession): { session: RecordedSession; redactions: number };
}

export function defaultPiiScrubber(opts: DefaultPiiScrubberOptions = {}): ReportingPiiScrubber {
  const token = opts.redactionToken ?? DEFAULT_TOKEN;
  const extraRules = opts.extraRules ?? [];
  const allowlist = new Set(opts.selectorAllowlist ?? []);

  function scrubStep(step: RecordedStep): { step: RecordedStep; redactions: number } {
    let redactions = 0;
    const out: RecordedStep = { action: step.action };
    if (step.selector !== undefined) {
      const r = scrubSelector(step.selector, token, allowlist, extraRules);
      out.selector = r.text;
      redactions += r.redactions;
    }
    if (step.value !== undefined) {
      const r = redactContent(step.value, 'value', token, extraRules);
      out.value = r.text;
      redactions += r.redactions;
    }
    return { step: out, redactions };
  }

  function scrubWithReport(session: RawTrafficSession): {
    session: RecordedSession;
    redactions: number;
  } {
    let redactions = 0;
    const url = redactContent(session.url, 'url', token, extraRules);
    redactions += url.redactions;
    const steps = session.steps.map((step) => {
      const r = scrubStep(step);
      redactions += r.redactions;
      return r.step;
    });
    return {
      session: { url: url.text, startedAt: session.startedAt, steps },
      redactions,
    };
  }

  return {
    scrub(session) {
      return scrubWithReport(session).session;
    },
    scrubWithReport,
  };
}
