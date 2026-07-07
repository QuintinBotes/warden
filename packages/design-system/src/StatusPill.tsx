import type { ReactNode } from 'react';
import { cx } from './cx';
import type { SentinelStatus } from './tokens';

/** Class modifier + default label for each status role. */
export const STATUS_META: Record<SentinelStatus, { className: string; label: string }> = {
  PASS: { className: 'pass', label: 'Pass' },
  FAIL: { className: 'fail', label: 'Fail' },
  FLAKY: { className: 'flaky', label: 'Flaky' },
  BLOCKED: { className: 'blocked', label: 'Blocked' },
  SKIPPED: { className: 'skip', label: 'Skipped' },
  QUARANTINED: { className: 'quar', label: 'Quarantined' },
  NOT_TESTED: { className: 'nt', label: 'Not tested' },
};

export interface StatusPillProps {
  status: SentinelStatus;
  /** Overrides the default label for the status. */
  children?: ReactNode;
  className?: string;
}

/**
 * A colored, labeled status pill with a leading dot. The status color is the
 * loudest thing on the pill; ground stays quiet so it carries.
 */
export function StatusPill({ status, children, className }: StatusPillProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cx('sentinel-pill', `sentinel-pill--${meta.className}`, className)}
      data-status={status}
    >
      <span className="sentinel-pill-dot" aria-hidden="true" />
      {children ?? meta.label}
    </span>
  );
}
