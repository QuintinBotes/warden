// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusPill } from './StatusPill';
import type { SentinelStatus } from './tokens';

afterEach(cleanup);

const CASES: Array<[SentinelStatus, string]> = [
  ['PASS', 'Pass'],
  ['FAIL', 'Fail'],
  ['FLAKY', 'Flaky'],
  ['BLOCKED', 'Blocked'],
  ['SKIPPED', 'Skipped'],
  ['QUARANTINED', 'Quarantined'],
  ['NOT_TESTED', 'Not tested'],
];

describe('StatusPill', () => {
  it.each(CASES)('shows the default label for %s', (status, label) => {
    render(<StatusPill status={status} />);
    const pill = screen.getByText(label);
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute('data-status', status);
  });

  it('renders custom children in place of the default label', () => {
    render(<StatusPill status="PASS">Cleared to merge</StatusPill>);
    expect(screen.getByText('Cleared to merge')).toBeInTheDocument();
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
  });

  it('applies the status modifier class and passthrough className', () => {
    render(<StatusPill status="FAIL" className="extra" />);
    const pill = screen.getByText('Fail');
    expect(pill).toHaveClass('sentinel-pill', 'sentinel-pill--fail', 'extra');
  });
});
