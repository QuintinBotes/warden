// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TrendTile } from './TrendTile';

afterEach(cleanup);

describe('TrendTile', () => {
  it('renders label, value, delta, and a sparkline', () => {
    const { container } = render(
      <TrendTile
        label="Pass rate · 30d"
        value="93.6%"
        delta="▲ 1.8 pts"
        tone="pass"
        trend="up"
        points={[30, 27, 28, 22, 24, 16, 18, 11, 9]}
      />,
    );
    expect(screen.getByText('Pass rate · 30d')).toBeInTheDocument();
    expect(screen.getByText('93.6%')).toBeInTheDocument();
    expect(screen.getByText('▲ 1.8 pts')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="pass"]')).toBeInTheDocument();

    const svg = container.querySelector('svg.sentinel-spark')!;
    expect(svg).toBeInTheDocument();
    // area + polyline + emphasized endpoint marker
    expect(svg.querySelector('polyline.sentinel-spark-line')).toBeInTheDocument();
    expect(svg.querySelector('path.sentinel-spark-area')).toBeInTheDocument();
    expect(svg.querySelector('circle.sentinel-spark-dot')).toBeInTheDocument();
  });

  it('omits the sparkline for an empty series and the delta when absent', () => {
    const { container } = render(<TrendTile label="MTTR" value="4.2h" points={[]} />);
    expect(container.querySelector('svg.sentinel-spark')).toBeNull();
    expect(container.querySelector('.sentinel-tile-delta')).toBeNull();
  });
});
