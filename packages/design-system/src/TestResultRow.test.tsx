// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TestResultRow } from './TestResultRow';

afterEach(cleanup);

describe('TestResultRow', () => {
  it('renders name, formatted duration, tags, and a status pill', () => {
    render(
      <TestResultRow
        name="checkout › complete with credit card"
        durationMs={8423}
        tags={['@apps/checkout', '@regression']}
        status="FAIL"
      />,
    );
    expect(screen.getByText('checkout › complete with credit card')).toBeInTheDocument();
    expect(screen.getByText('8,423ms')).toBeInTheDocument();
    expect(screen.getByText('@apps/checkout')).toBeInTheDocument();
    expect(screen.getByText('@regression')).toBeInTheDocument();
    const pill = screen.getByText('Fail');
    expect(pill).toHaveAttribute('data-status', 'FAIL');
  });

  it('renders an em-dash when duration is omitted', () => {
    render(<TestResultRow name="admin › bulk export" status="QUARANTINED" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Quarantined')).toBeInTheDocument();
  });
});
