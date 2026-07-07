/**
 * Sentinel design tokens.
 *
 * Status semantics ARE the palette — the six test statuses are the loudest
 * colors on the screen. Beacon gold (`accent`) is the brand accent and is
 * deliberately NOT a status. Three themes: `signal` (near-black, the default
 * house theme), `watch` (slate-teal dark), and `day` (warm light).
 *
 * The canonical source is docs/design/sentinel-design-system.html; these
 * values mirror sentinel.css so consumers can reach the tokens from TS.
 */

export type Theme = 'signal' | 'watch' | 'day';

/**
 * The seven status roles the design system renders. The first six are the
 * "loud" alarm statuses; NOT_TESTED is an absence marker.
 */
export type SentinelStatus =
  'PASS' | 'FAIL' | 'FLAKY' | 'BLOCKED' | 'SKIPPED' | 'QUARANTINED' | 'NOT_TESTED';

export interface GroundScale {
  /** Page ground — the darkest (dark themes) / base paper (day). */
  g0: string;
  g1: string;
  g2: string;
  g3: string;
  /** Hairline border. */
  hair: string;
}

export interface InkScale {
  ink0: string;
  ink1: string;
  ink2: string;
}

/** The six loud status colors per theme (excludes NOT_TESTED, which is neutral). */
export interface StatusColors {
  PASS: string;
  FAIL: string;
  FLAKY: string;
  BLOCKED: string;
  SKIPPED: string;
  QUARANTINED: string;
}

/** Ordered list of themes; `signal` is the default. */
export const themes: Theme[] = ['signal', 'watch', 'day'];

/** The default house theme (`:root` in sentinel.css). */
export const defaultTheme: Theme = 'signal';

export const tokens = {
  themes,
  defaultTheme,

  statusColors: {
    signal: {
      PASS: '#43D19A',
      FAIL: '#FF5B60',
      FLAKY: '#FFB04A',
      BLOCKED: '#AC9DF3',
      SKIPPED: '#8A9B9D',
      QUARANTINED: '#F08466',
    },
    watch: {
      PASS: '#43B98A',
      FAIL: '#E5484D',
      FLAKY: '#E08A2C',
      BLOCKED: '#8B7BD8',
      SKIPPED: '#6B7C82',
      QUARANTINED: '#C2624B',
    },
    day: {
      PASS: '#157A56',
      FAIL: '#C0343A',
      FLAKY: '#9C6015',
      BLOCKED: '#5B4CB0',
      SKIPPED: '#566468',
      QUARANTINED: '#9B4630',
    },
  } satisfies Record<Theme, StatusColors>,

  ground: {
    signal: { g0: '#05090A', g1: '#0A1113', g2: '#10191B', g3: '#17262A', hair: '#2E4247' },
    watch: { g0: '#0B1417', g1: '#0F1E23', g2: '#16292F', g3: '#1D343A', hair: '#24393F' },
    day: { g0: '#F1EEE5', g1: '#FBF9F2', g2: '#E9E4D7', g3: '#E0DACB', hair: '#D7D0C0' },
  } satisfies Record<Theme, GroundScale>,

  ink: {
    signal: { ink0: '#FFFFFF', ink1: '#D6DEDD', ink2: '#98A4A3' },
    watch: { ink0: '#F0EADD', ink1: '#A6B2B1', ink2: '#6E7D7F' },
    day: { ink0: '#13201E', ink1: '#4B5A55', ink2: '#77837E' },
  } satisfies Record<Theme, InkScale>,

  /** Beacon-gold brand accent — logo, focus, primary action. NOT a status. */
  accent: {
    signal: '#FFC24D',
    watch: '#E9B44C',
    day: '#A8781A',
  } satisfies Record<Theme, string>,

  type: {
    mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },

  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2.5rem',
  },

  radii: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    pill: '999px',
  },
} as const;

export type Tokens = typeof tokens;
