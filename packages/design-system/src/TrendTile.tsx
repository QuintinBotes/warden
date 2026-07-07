import { cx } from './cx';

export type TrendTone = 'pass' | 'fail' | 'flaky' | 'blocked' | 'skip' | 'quar' | 'neutral';
export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendTileProps {
  label: string;
  value: string | number;
  /** Pre-formatted delta text, e.g. "▲ 1.8 pts". */
  delta?: string;
  /** Colors the value + sparkline. Defaults to `neutral`. */
  tone?: TrendTone;
  /** Colors the delta text. Defaults to `flat`. */
  trend?: TrendDirection;
  /** Sparkline series, oldest → newest. */
  points: number[];
  className?: string;
}

const SVG_W = 120;
const SVG_H = 38;
const PAD = 4;

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

interface Sparkline {
  line: string;
  area: string;
  end: { x: number; y: number };
}

function buildSparkline(points: number[]): Sparkline | null {
  if (points.length === 0) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((v, i) => {
    const x = points.length === 1 ? SVG_W : (i / (points.length - 1)) * SVG_W;
    const y = PAD + (1 - (v - min) / range) * (SVG_H - 2 * PAD);
    return { x: round(x), y: round(y) };
  });
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const line = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const area =
    `M ${first.x} ${first.y} ` +
    coords
      .slice(1)
      .map((c) => `L ${c.x} ${c.y}`)
      .join(' ') +
    ` L ${last.x} ${SVG_H} L ${first.x} ${SVG_H} Z`;
  return { line, area, end: last };
}

/**
 * A KPI tile: label, big tabular value, optional delta, and an inline SVG area
 * sparkline with an emphasized endpoint marker.
 */
export function TrendTile({
  label,
  value,
  delta,
  tone = 'neutral',
  trend = 'flat',
  points,
  className,
}: TrendTileProps) {
  const spark = buildSparkline(points);

  return (
    <div className={cx('sentinel-tile', className)} data-tone={tone}>
      <div className="sentinel-tile-label">{label}</div>
      <div className="sentinel-tile-value sentinel-tnum">{value}</div>
      {delta !== undefined ? (
        <div className="sentinel-tile-delta sentinel-tnum" data-trend={trend}>
          {delta}
        </div>
      ) : null}
      {spark ? (
        <svg
          className="sentinel-spark"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="sentinel-spark-area" d={spark.area} />
          <polyline className="sentinel-spark-line" points={spark.line} fill="none" />
          <circle className="sentinel-spark-dot" cx={spark.end.x} cy={spark.end.y} r={3} />
        </svg>
      ) : null}
    </div>
  );
}
