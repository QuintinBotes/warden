import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';
import { tokens, themes } from './tokens';
import type { SentinelStatus } from './tokens';

describe('contrastRatio (pure WCAG)', () => {
  it('black on white is the maximum 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('is 1:1 for identical colors', () => {
    expect(contrastRatio('#43D19A', '#43D19A')).toBeCloseTo(1, 10);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#05090A', '#FFC24D')).toBeCloseTo(
      contrastRatio('#FFC24D', '#05090A'),
      10,
    );
  });

  it('accepts shorthand hex and a leading #, or not', () => {
    expect(contrastRatio('#fff', 'fff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('rejects invalid hex', () => {
    expect(() => contrastRatio('nope', '#000')).toThrow();
  });

  it('relativeLuminance is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });
});

describe('status colors clear WCAG AA against their theme ground', () => {
  // Every status color must be legible: WCAG AA text contrast (>= 4.5:1) against
  // the theme surface it renders on (the near-black page in dark themes, the light
  // card in Day) — including the muted SKIPPED neutral.
  const ALL: SentinelStatus[] = ['PASS', 'FAIL', 'FLAKY', 'BLOCKED', 'QUARANTINED', 'SKIPPED'];

  for (const theme of themes) {
    const status = tokens.statusColors[theme];
    const { g0, g1 } = tokens.ground[theme];
    // The surface a status renders on: whichever ground it contrasts best with.
    const groundContrast = (hex: string) =>
      Math.max(contrastRatio(hex, g0), contrastRatio(hex, g1));

    describe(theme, () => {
      for (const s of ALL) {
        it(`${s} meets AA (>= 4.5:1)`, () => {
          expect(groundContrast(status[s])).toBeGreaterThanOrEqual(4.5);
        });
      }

      it('accent gold is not reused as any status color', () => {
        const accent = tokens.accent[theme].toLowerCase();
        for (const value of Object.values(status)) {
          expect(value.toLowerCase()).not.toBe(accent);
        }
      });
    });
  }
});
