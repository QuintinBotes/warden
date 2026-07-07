// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PortcullisLogo } from './PortcullisLogo';

afterEach(cleanup);

describe('PortcullisLogo', () => {
  it('exposes an accessible image when given a title', () => {
    render(<PortcullisLogo title="Warden" size={48} />);
    const mark = screen.getByRole('img', { name: 'Warden' });
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveAttribute('viewBox', '0 0 48 48');
    expect(mark).toHaveAttribute('width', '48');
  });

  it('is decorative (aria-hidden) without a title', () => {
    const { container } = render(<PortcullisLogo />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
  });

  it('passes through className', () => {
    const { container } = render(<PortcullisLogo className="brand-mark" />);
    expect(container.querySelector('svg')).toHaveClass('sentinel-portcullis', 'brand-mark');
  });
});
