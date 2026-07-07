import { cx } from './cx';

export type VerdictDecision = 'PASS' | 'WARN' | 'BLOCK';

export interface VerdictMeta {
  label: string;
  value: string;
}

export interface VerdictCardProps {
  decision: VerdictDecision;
  reason: string;
  meta?: VerdictMeta[];
  className?: string;
}

const DECISION_META: Record<VerdictDecision, { className: string; word: string }> = {
  PASS: { className: 'pass', word: 'Gate open' },
  WARN: { className: 'warn', word: 'Gate warned' },
  BLOCK: { className: 'block', word: 'Gate held' },
};

/**
 * The gate verdict card: a status stripe, the decision word, the reason, and an
 * optional row of labeled meta stats. The stripe and decision take the
 * decision's status color.
 */
export function VerdictCard({ decision, reason, meta, className }: VerdictCardProps) {
  const d = DECISION_META[decision];
  return (
    <div
      className={cx('sentinel-verdict', `sentinel-verdict--${d.className}`, className)}
      data-decision={decision}
    >
      <div className="sentinel-verdict-stripe" aria-hidden="true" />
      <div className="sentinel-verdict-body">
        <div className="sentinel-verdict-top">
          <span className="sentinel-verdict-decision">{d.word}</span>
        </div>
        <p className="sentinel-verdict-reason">{reason}</p>
        {meta && meta.length > 0 ? (
          <div className="sentinel-verdict-foot">
            {meta.map((m, i) => (
              <span key={`${m.label}-${i}`} className="sentinel-verdict-metaitem">
                {m.label} <b className="sentinel-tnum">{m.value}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
