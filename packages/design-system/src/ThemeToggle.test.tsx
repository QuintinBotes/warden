// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from './ThemeToggle';
import { applyTheme } from './theme';

afterEach(cleanup);

describe('ThemeToggle', () => {
  it('renders the three themes and marks the active one pressed', () => {
    render(<ThemeToggle theme="watch" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Signal' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Watch' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the chosen theme', () => {
    const onChange = vi.fn();
    render(<ThemeToggle theme="signal" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(onChange).toHaveBeenCalledWith('day');
  });
});

describe('applyTheme', () => {
  it('stamps data-theme on the given element', () => {
    const el = document.createElement('div');
    applyTheme('watch', el);
    expect(el.getAttribute('data-theme')).toBe('watch');
    applyTheme('day', el);
    expect(el.getAttribute('data-theme')).toBe('day');
  });

  it('defaults to the document root', () => {
    applyTheme('signal');
    expect(document.documentElement.getAttribute('data-theme')).toBe('signal');
  });
});
