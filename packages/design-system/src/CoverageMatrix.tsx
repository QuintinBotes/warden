import { cx } from './cx';
import { StatusPill, STATUS_META } from './StatusPill';
import type { SentinelStatus } from './tokens';

export interface CoverageCellData {
  /** Column header this cell belongs under (e.g. an app or module name). */
  col: string;
  status: SentinelStatus;
}

export interface CoverageMatrixRow {
  requirementId: string;
  title: string;
  /** Test-case ids covering the requirement. Empty renders as "— none —". */
  tests: string[];
  cells: CoverageCellData[];
  /** Rolled-up status for the requirement, shown as a pill. */
  status: SentinelStatus;
}

export interface CoverageMatrixProps {
  rows: CoverageMatrixRow[];
  className?: string;
}

/** First-seen-ordered union of column names across every row. */
function deriveColumns(rows: CoverageMatrixRow[]): string[] {
  const cols: string[] = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cols.includes(cell.col)) cols.push(cell.col);
    }
  }
  return cols;
}

/**
 * The coverage matrix: requirement × test × last-result. Columns are derived
 * from the rows' cells. Scrolls horizontally when it outgrows its container.
 */
export function CoverageMatrix({ rows, className }: CoverageMatrixProps) {
  const columns = deriveColumns(rows);

  return (
    <div className={cx('sentinel-matrix-scroll', className)}>
      <table className="sentinel-matrix">
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Tests</th>
            {columns.map((col) => (
              <th scope="col" key={col}>
                {col}
              </th>
            ))}
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const byCol = new Map(row.cells.map((c) => [c.col, c.status]));
            return (
              <tr key={row.requirementId}>
                <td className="sentinel-matrix-req">
                  {row.requirementId} · {row.title}
                </td>
                <td className="sentinel-matrix-tc">
                  {row.tests.length > 0 ? row.tests.join(', ') : '— none —'}
                </td>
                {columns.map((col) => {
                  const status = byCol.get(col) ?? 'NOT_TESTED';
                  const meta = STATUS_META[status];
                  return (
                    <td key={col}>
                      <span
                        className={cx('sentinel-cell', `sentinel-cell--${meta.className}`)}
                        data-status={status}
                        role="img"
                        aria-label={`${col}: ${meta.label}`}
                      />
                    </td>
                  );
                })}
                <td>
                  <StatusPill status={row.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
