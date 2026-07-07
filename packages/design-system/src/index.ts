/**
 * @warden/design-system — Sentinel.
 *
 * A dark-first command-center design system where a test's status is the
 * loudest color on the screen and the portcullis is both logo and verdict.
 *
 * Consumers must also import the stylesheet once:
 *   import '@warden/design-system/sentinel.css';
 */

// Tokens & theming
export { tokens, themes, defaultTheme } from './tokens';
export type { Theme, Tokens, SentinelStatus, GroundScale, InkScale, StatusColors } from './tokens';
export { applyTheme } from './theme';

// Utilities
export { contrastRatio, relativeLuminance } from './contrast';

// Components
export { PortcullisLogo } from './PortcullisLogo';
export type { PortcullisLogoProps } from './PortcullisLogo';

export { StatusPill, STATUS_META } from './StatusPill';
export type { StatusPillProps } from './StatusPill';

export { VerdictCard } from './VerdictCard';
export type { VerdictCardProps, VerdictDecision, VerdictMeta } from './VerdictCard';

export { CoverageMatrix } from './CoverageMatrix';
export type { CoverageMatrixProps, CoverageMatrixRow, CoverageCellData } from './CoverageMatrix';

export { TestResultRow } from './TestResultRow';
export type { TestResultRowProps } from './TestResultRow';

export { TrendTile } from './TrendTile';
export type { TrendTileProps, TrendTone, TrendDirection } from './TrendTile';

export { ThemeToggle } from './ThemeToggle';
export type { ThemeToggleProps } from './ThemeToggle';

export { ReplayViewer } from './ReplayViewer';
export type { ReplayViewerProps } from './ReplayViewer';
