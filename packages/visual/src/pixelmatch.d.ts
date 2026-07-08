/**
 * Ambient declaration for `pixelmatch` v6 (ships no bundled types and no `@types` package).
 * Mirrors the runtime signature: compares two RGBA buffers, optionally writes a highlighted
 * diff into `output`, and returns the count of mismatched pixels.
 */
declare module 'pixelmatch' {
  interface PixelmatchOptions {
    /** Matching threshold (0..1); smaller is more sensitive. */
    threshold?: number;
    /** Whether to skip anti-aliasing detection. */
    includeAA?: boolean;
    /** Opacity of the original image in the diff output. */
    alpha?: number;
    /** Color of anti-aliased pixels in the diff output. */
    aaColor?: [number, number, number];
    /** Color of different pixels in the diff output. */
    diffColor?: [number, number, number];
    /** Alternative diff color for dark-on-light differences. */
    diffColorAlt?: [number, number, number] | null;
    /** Draw the diff over a transparent background (a mask). */
    diffMask?: boolean;
  }

  export default function pixelmatch(
    img1: Uint8Array | Uint8ClampedArray | Buffer,
    img2: Uint8Array | Uint8ClampedArray | Buffer,
    output: Uint8Array | Uint8ClampedArray | Buffer | null,
    width: number,
    height: number,
    options?: PixelmatchOptions,
  ): number;
}
