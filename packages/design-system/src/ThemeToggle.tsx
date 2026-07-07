import { cx } from './cx';
import { themes } from './tokens';
import type { Theme } from './tokens';

export interface ThemeToggleProps {
  theme: Theme;
  onChange: (theme: Theme) => void;
  className?: string;
}

const THEME_LABEL: Record<Theme, string> = {
  signal: 'Signal',
  watch: 'Watch',
  day: 'Day',
};

/**
 * Signal / Watch / Day segmented switch. Calls `onChange` with the chosen
 * theme; stamping `document.documentElement` is the consumer's job (see
 * `applyTheme`).
 */
export function ThemeToggle({ theme, onChange, className }: ThemeToggleProps) {
  return (
    <div className={cx('sentinel-switch', className)} role="group" aria-label="Theme">
      {themes.map((t) => (
        <button
          key={t}
          type="button"
          className="sentinel-switch-btn"
          data-theme-btn={t}
          aria-pressed={t === theme}
          onClick={() => onChange(t)}
        >
          {THEME_LABEL[t]}
        </button>
      ))}
    </div>
  );
}
