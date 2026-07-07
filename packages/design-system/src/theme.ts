import type { Theme } from './tokens';

/**
 * Apply a Sentinel theme by stamping `data-theme` on the document root (or a
 * supplied element). `signal` is the `:root` default in sentinel.css, but the
 * attribute is set explicitly for all themes so switching is symmetric and the
 * active theme is observable in the DOM.
 *
 * No-op in a non-DOM environment when no explicit element is passed.
 */
export function applyTheme(theme: Theme, root?: HTMLElement): void {
  const el = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!el) return;
  el.setAttribute('data-theme', theme);
}
