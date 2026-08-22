// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DashboardClient, { type DashboardData } from './dashboard-client';

afterEach(cleanup);

type ResultRow = DashboardData['results'][number];

const kpi = (label: string) => ({
  label,
  value: '100%',
  delta: 'no change',
  trend: 'flat' as const,
  tone: 'neutral' as const,
  points: [10, 20],
});

/** A minimal snapshot whose only interesting part is `results`. */
function makeData(results: ResultRow[], over: Partial<DashboardData> = {}): DashboardData {
  return {
    generatedAt: '2026-08-22T00:00:00.000Z',
    run: {
      trigger: 'v1@ecd991f',
      environment: 'local-macos',
      ranAt: 'Aug 21',
      requirementCount: 0,
      testCount: results.length,
    },
    kpis: {
      passRate: kpi('Pass rate'),
      flakeRate: kpi('Flake rate'),
      mttr: kpi('MTTR'),
      coverage: kpi('Coverage'),
    },
    latestGate: { decision: 'PASS', reason: 'All required checks passed.', meta: [] },
    coverageColumns: [],
    coverageRows: [],
    results,
    defaultSelectedId: results[0]?.id ?? null,
    flake: [],
    learning: [],
    coverageSync: [],
    cujBoard: [],
    visual: [],
    flakeTrend: { points: [], topOffenders: [] },
    ...over,
  };
}

/** `count` passing results named `unit › case 001`, `unit › case 002`, … */
function passingResults(count: number): ResultRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `TC-${String(i + 1).padStart(4, '0')}`,
    name: `unit › case ${String(i + 1).padStart(3, '0')}`,
    durationMs: 10 + i,
    tags: [],
    status: 'PASS' as const,
    replay: null,
  }));
}

function rowNames(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((el) => el.querySelector('.sentinel-trow-name')!.textContent!);
}

describe('DashboardClient — the test-results list', () => {
  it('draws one page of rows rather than every result in the run', () => {
    render(<DashboardClient data={makeData(passingResults(3231))} />);

    const names = rowNames();
    expect(names.length).toBeLessThanOrEqual(50);
    expect(names[0]).toBe('unit › case 001');
    expect(screen.queryByText('unit › case 3231')).not.toBeInTheDocument();
  });

  it('says which page it is showing and how many results there are', () => {
    render(<DashboardClient data={makeData(passingResults(120))} />);

    expect(screen.getByText('Page 1 of 3 · showing 1–50 of 120')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(screen.getByText('Page 2 of 3 · showing 51–100 of 120')).toBeInTheDocument();
    expect(rowNames()[0]).toBe('unit › case 051');
  });

  it('filters by test name, case-insensitively', async () => {
    render(<DashboardClient data={makeData(passingResults(120))} />);

    fireEvent.change(screen.getByLabelText('Filter test results by name'), {
      target: { value: 'CASE 007' },
    });

    expect(await screen.findByText('unit › case 007')).toBeInTheDocument();
    expect(rowNames()).toEqual(['unit › case 007']);
  });

  it('counts the matches against the run total instead of redefining the run total', async () => {
    const results = passingResults(120);
    results[3] = { ...results[3]!, status: 'FAIL' };

    render(<DashboardClient data={makeData(results)} />);
    expect(screen.getByText('120 tests · 1 failing')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter test results by name'), {
      target: { value: 'case 004' },
    });

    expect(await screen.findByText('1 of 120 tests match · 1 of 1 failing')).toBeInTheDocument();
  });

  it('offers a status filter for the statuses the run actually produced, and no others', () => {
    const results = passingResults(6);
    results[0] = { ...results[0]!, status: 'FAIL' };

    render(<DashboardClient data={makeData(results)} />);

    const select = screen.getByLabelText('Filter test results by status');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['All statuses', 'Fail', 'Pass']);
  });

  it('narrows the list to the chosen status', () => {
    const results = passingResults(6);
    results[2] = { ...results[2]!, status: 'FAIL' };

    render(<DashboardClient data={makeData(results)} />);

    fireEvent.change(screen.getByLabelText('Filter test results by status'), {
      target: { value: 'FAIL' },
    });

    expect(rowNames()).toEqual(['unit › case 003']);
    expect(screen.getByText('1 of 6 tests match · 1 of 1 failing')).toBeInTheDocument();
  });

  it('says so when nothing matches, instead of showing an empty panel', async () => {
    render(<DashboardClient data={makeData(passingResults(20))} />);

    fireEvent.change(screen.getByLabelText('Filter test results by name'), {
      target: { value: 'no such test' },
    });

    expect(await screen.findByText('No test in this run matches that filter.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('still drives the replay panel from the selected row', () => {
    const results = passingResults(4).map((r) => ({
      ...r,
      replay: {
        errorMessage: null,
        screenshots: ['data:image/svg+xml;utf8,<svg/>'],
        tracePath: 'data:application/json,{}',
      },
    }));

    render(<DashboardClient data={makeData(results)} />);
    expect(screen.getByRole('heading', { name: 'unit › case 001' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('unit › case 003'));
    expect(screen.getByRole('heading', { name: 'unit › case 003' })).toBeInTheDocument();
  });
});

describe('DashboardClient — the replay panel', () => {
  const withReplay = (r: ResultRow): ResultRow => ({
    ...r,
    replay: {
      errorMessage: null,
      screenshots: ['data:image/svg+xml;utf8,<svg/>'],
      tracePath: 'data:application/json,{}',
    },
  });

  it('does not head a test name when no result in the run captured any media', () => {
    // Every result has replay: null — a Vitest run, which captures no screenshots.
    render(<DashboardClient data={makeData(passingResults(3))} />);

    expect(screen.queryByRole('heading', { name: 'unit › case 001' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Replay' })).toBeInTheDocument();
  });

  it('says the absence is the run’s, and what does capture media, when the run has none', () => {
    render(<DashboardClient data={makeData(passingResults(3))} />);

    expect(
      screen.getByText('No replay media was captured anywhere in this run.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Playwright run with screenshots or tracing/i)).toBeInTheDocument();
  });

  it('blames the selected test when the run has media but that test does not', () => {
    const results = passingResults(3);
    results[0] = withReplay(results[0]!);

    render(<DashboardClient data={makeData(results)} />);
    fireEvent.click(screen.getByText('unit › case 002'));

    expect(screen.getByRole('heading', { name: 'unit › case 002' })).toBeInTheDocument();
    expect(screen.getByText('No replay media captured for this test.')).toBeInTheDocument();
  });

  it('shows the media when the selected test captured some', () => {
    const results = passingResults(3).map(withReplay);

    render(<DashboardClient data={makeData(results)} />);

    expect(screen.getByRole('heading', { name: 'unit › case 001' })).toBeInTheDocument();
    expect(screen.getByAltText('Screenshot 1')).toBeInTheDocument();
    expect(screen.getByText('Download trace')).toBeInTheDocument();
  });
});
