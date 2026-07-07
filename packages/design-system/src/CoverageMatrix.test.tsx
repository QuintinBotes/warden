// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CoverageMatrix } from './CoverageMatrix';
import type { CoverageMatrixRow } from './CoverageMatrix';

afterEach(cleanup);

const ROWS: CoverageMatrixRow[] = [
  {
    requirementId: 'ISSUE-201',
    title: 'Credit-card checkout',
    tests: ['TC-042', 'TC-043'],
    status: 'FAIL',
    cells: [
      { col: 'Checkout', status: 'FAIL' },
      { col: 'Cart', status: 'PASS' },
      { col: 'Auth', status: 'PASS' },
    ],
  },
  {
    requirementId: 'ISSUE-217',
    title: 'Guest checkout',
    tests: [],
    status: 'NOT_TESTED',
    cells: [{ col: 'Checkout', status: 'NOT_TESTED' }],
  },
];

describe('CoverageMatrix', () => {
  it('renders a scrollable table with derived columns', () => {
    render(<CoverageMatrix rows={ROWS} />);
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    // Requirement + Tests + (Checkout, Cart, Auth) + Status = 6 headers
    expect(screen.getAllByRole('columnheader')).toHaveLength(6);
    expect(screen.getByRole('columnheader', { name: 'Checkout' })).toBeInTheDocument();
  });

  it('renders each requirement row with its rolled-up status pill', () => {
    render(<CoverageMatrix rows={ROWS} />);
    const row = screen.getByText(/ISSUE-201/).closest('tr')!;
    const pill = within(row).getByText('Fail');
    expect(pill).toHaveAttribute('data-status', 'FAIL');
    expect(within(row).getByText('TC-042, TC-043')).toBeInTheDocument();
  });

  it('shows "— none —" when a requirement has no tests', () => {
    render(<CoverageMatrix rows={ROWS} />);
    expect(screen.getByText('— none —')).toBeInTheDocument();
  });
});
