// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VerdictCard } from './VerdictCard';

afterEach(cleanup);

describe('VerdictCard', () => {
  it('shows the decision, reason, and meta stats', () => {
    render(
      <VerdictCard
        decision="BLOCK"
        reason="Payment fails for Visa cards ending 4242."
        meta={[
          { label: 'Risk', value: '7/10' },
          { label: 'Pass rate', value: '44/47' },
        ]}
      />,
    );
    expect(screen.getByText('Gate held')).toBeInTheDocument();
    expect(screen.getByText(/Payment fails for Visa cards/)).toBeInTheDocument();
    expect(screen.getByText('Risk')).toBeInTheDocument();
    expect(screen.getByText('7/10')).toBeInTheDocument();
    expect(screen.getByText('44/47')).toBeInTheDocument();
  });

  it('reflects the decision on the root element', () => {
    const { container } = render(<VerdictCard decision="PASS" reason="All exit criteria met." />);
    const card = container.querySelector('.sentinel-verdict')!;
    expect(card).toHaveAttribute('data-decision', 'PASS');
    expect(card).toHaveClass('sentinel-verdict--pass');
    expect(screen.getByText('Gate open')).toBeInTheDocument();
  });

  it('renders WARN styling', () => {
    const { container } = render(<VerdictCard decision="WARN" reason="Two flaky tests." />);
    expect(container.querySelector('.sentinel-verdict--warn')).toBeInTheDocument();
    expect(screen.getByText('Gate warned')).toBeInTheDocument();
  });

  it('omits the meta footer when no meta is given', () => {
    const { container } = render(<VerdictCard decision="PASS" reason="Clean." />);
    expect(container.querySelector('.sentinel-verdict-foot')).toBeNull();
  });
});
