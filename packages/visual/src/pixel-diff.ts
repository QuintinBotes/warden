import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { PixelDiffResult, WardenConfig } from '@warden/core';

/** A clustered change region in the diff. */
export type BoundingBox = { x: number; y: number; w: number; h: number };

/** Cap on the number of clustered regions returned, so a fully-scattered diff stays bounded. */
const MAX_BOXES = 100;

/**
 * Deterministic pixel comparison — a pure function; the noise floor under the AI judge.
 *
 * Decodes both PNGs, runs `pixelmatch` with `visual.antiAliasTolerance` as the matching
 * threshold and anti-aliasing detection on (so sub-pixel AA does not count), and returns the
 * changed-pixel ratio, a highlighted diff PNG, and the changed pixels clustered into bounding
 * boxes (4-connected components). When the two images differ in geometry, the whole candidate
 * is treated as changed (`changedRatio === 1`).
 */
export function pixelDiff(a: Uint8Array, b: Uint8Array, cfg: WardenConfig): PixelDiffResult {
  const baseline = PNG.sync.read(Buffer.from(a));
  const candidate = PNG.sync.read(Buffer.from(b));

  if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
    const { width, height } = candidate;
    return {
      changedRatio: 1,
      diffPng: b,
      boundingBoxes: width > 0 && height > 0 ? [{ x: 0, y: 0, w: width, h: height }] : [],
    };
  }

  const { width, height } = baseline;
  const total = width * height;
  const diff = new PNG({ width, height });

  const changed = pixelmatch(baseline.data, candidate.data, diff.data, width, height, {
    threshold: cfg.visual.antiAliasTolerance,
    includeAA: false,
    diffColor: [255, 0, 0],
  });

  const changedRatio = total === 0 ? 0 : changed / total;
  const diffPng = new Uint8Array(PNG.sync.write(diff));
  const boundingBoxes = clusterChangedRegions(diff.data, width, height);

  return { changedRatio, diffPng, boundingBoxes };
}

/**
 * Clusters changed pixels (drawn as pure red by `pixelmatch`) into 4-connected components and
 * returns each component's bounding box, sorted top-to-bottom then left-to-right for stable
 * output. Bounded to {@link MAX_BOXES} regions.
 */
function clusterChangedRegions(data: Buffer, width: number, height: number): BoundingBox[] {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o] === 255 && data[o + 1] === 0 && data[o + 2] === 0) mask[i] = 1;
  }

  const visited = new Uint8Array(width * height);
  const boxes: BoundingBox[] = [];
  const stack: number[] = [];

  for (let start = 0; start < width * height; start++) {
    if (mask[start] !== 1 || visited[start] === 1) continue;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    stack.length = 0;
    stack.push(start);
    visited[start] = 1;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      if (x > 0) pushNeighbor(idx - 1, mask, visited, stack);
      if (x < width - 1) pushNeighbor(idx + 1, mask, visited, stack);
      if (y > 0) pushNeighbor(idx - width, mask, visited, stack);
      if (y < height - 1) pushNeighbor(idx + width, mask, visited, stack);
    }

    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    if (boxes.length >= MAX_BOXES) break;
  }

  boxes.sort((l, r) => (l.y === r.y ? l.x - r.x : l.y - r.y));
  return boxes;
}

function pushNeighbor(idx: number, mask: Uint8Array, visited: Uint8Array, stack: number[]): void {
  if (mask[idx] === 1 && visited[idx] === 0) {
    visited[idx] = 1;
    stack.push(idx);
  }
}
