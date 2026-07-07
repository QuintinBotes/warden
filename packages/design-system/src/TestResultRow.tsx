import { cx } from './cx';
import { StatusPill } from './StatusPill';
import type { SentinelStatus } from './tokens';

export interface TestResultRowProps {
  name: string;
  /** Duration in milliseconds. Omitted renders as an em-dash. */
  durationMs?: number;
  tags?: string[];
  status: SentinelStatus;
  className?: string;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return '—';
  return `${Math.round(ms).toLocaleString('en-US')}ms`;
}

/**
 * A single test-result row: name, optional tags, tabular duration, and a
 * trailing StatusPill.
 */
export function TestResultRow({ name, durationMs, tags, status, className }: TestResultRowProps) {
  return (
    <div className={cx('sentinel-trow', className)} data-status={status}>
      <div className="sentinel-trow-main">
        <div className="sentinel-trow-name">{name}</div>
        {tags && tags.length > 0 ? (
          <div className="sentinel-trow-tags">
            {tags.map((tag, i) => (
              <span key={`${tag}-${i}`} className="sentinel-tag">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <span className="sentinel-trow-dur sentinel-tnum">{formatDuration(durationMs)}</span>
      <StatusPill status={status} />
    </div>
  );
}
