import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { defineConfig } from '@warden/core';
import { pixelDiff } from './pixel-diff.js';
import { makePng } from './testing-fakes.js';

const cfg = defineConfig();

/** Build a white PNG with the given pixels painted black — for precise clustering assertions. */
function whiteWithBlacks(
  width: number,
  height: number,
  blacks: { x: number; y: number }[],
): Uint8Array {
  const set = new Set(blacks.map((p) => `${p.x},${p.y}`));
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const black = set.has(`${x},${y}`);
      png.data[o] = black ? 0 : 255;
      png.data[o + 1] = black ? 0 : 255;
      png.data[o + 2] = black ? 0 : 255;
      png.data[o + 3] = 255;
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

describe('pixelDiff', () => {
  it('reports changedRatio 0 and no regions for identical images', () => {
    const a = makePng(10, 10, { fill: [255, 255, 255, 255] });
    const b = makePng(10, 10, { fill: [255, 255, 255, 255] });

    const result = pixelDiff(a, b, cfg);

    expect(result.changedRatio).toBe(0);
    expect(result.boundingBoxes).toEqual([]);
  });

  it('reports the expected ratio and bounding box for a known N-pixel patch', () => {
    const baseline = makePng(10, 10, { fill: [255, 255, 255, 255] });
    const candidate = makePng(10, 10, {
      fill: [255, 255, 255, 255],
      patch: { x: 2, y: 3, w: 2, h: 2, color: [0, 0, 0, 255] },
    });

    const result = pixelDiff(baseline, candidate, cfg);

    expect(result.changedRatio).toBeCloseTo(4 / 100, 10);
    expect(result.boundingBoxes).toEqual([{ x: 2, y: 3, w: 2, h: 2 }]);
  });

  it('clusters two separated patches into two bounding boxes', () => {
    const baseline = whiteWithBlacks(12, 12, []);
    const candidate = whiteWithBlacks(12, 12, [
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    ]);

    const result = pixelDiff(baseline, candidate, cfg);

    expect(result.boundingBoxes).toHaveLength(2);
    expect(result.boundingBoxes[0]).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(result.boundingBoxes[1]).toEqual({ x: 9, y: 9, w: 1, h: 1 });
  });

  it('treats mismatched geometry as fully changed', () => {
    const small = makePng(4, 4, { fill: [255, 255, 255, 255] });
    const big = makePng(6, 6, { fill: [255, 255, 255, 255] });

    const result = pixelDiff(small, big, cfg);

    expect(result.changedRatio).toBe(1);
    expect(result.boundingBoxes).toEqual([{ x: 0, y: 0, w: 6, h: 6 }]);
  });
});
