/**
 * WCAG 2.x relative-contrast helpers. Pure, dependency-free, DOM-free.
 */

function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    throw new Error(`contrastRatio: invalid hex color "${hex}"`);
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Relative luminance of a hex color per the WCAG definition. Range [0, 1].
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/**
 * WCAG contrast ratio between two hex colors. Range [1, 21]; order-independent.
 * Accepts 3- or 6-digit hex (with or without leading `#`).
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
