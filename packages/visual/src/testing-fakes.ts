import { PNG } from 'pngjs';
import type {
  GenerateOptions,
  ImagePart,
  LLMProvider,
  Tool,
  ToolCallResult,
  VisualBaseline,
  VisualBaselineKey,
  VisualBaselineStore,
  VisualCheck,
  VisualEngine,
  VisualShot,
} from '@warden/core';
import type { VisualArtifactSink } from './compare.js';
import { keySlug } from './compare.js';
import type { VisualFs } from './git-baseline-store.js';

/**
 * Test doubles and fixtures owned by `@warden/visual` so its units are tested against fakes it
 * controls — never a live browser, network, LLM, or filesystem. Not exported from the package
 * barrel; unit tests import this module directly.
 */

export type Rgba = [number, number, number, number];

export interface MakePngOptions {
  fill?: Rgba;
  patch?: { x: number; y: number; w: number; h: number; color: Rgba };
}

/** Encodes a solid PNG (optionally with a rectangular patch) to raw bytes — a real, diffable PNG. */
export function makePng(width: number, height: number, opts: MakePngOptions = {}): Uint8Array {
  const png = new PNG({ width, height });
  const fill = opts.fill ?? [255, 255, 255, 255];
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = fill[0];
    png.data[o + 1] = fill[1];
    png.data[o + 2] = fill[2];
    png.data[o + 3] = fill[3];
  }
  if (opts.patch) {
    const { x, y, w, h, color } = opts.patch;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        const o = (yy * width + xx) * 4;
        png.data[o] = color[0];
        png.data[o + 1] = color[1];
        png.data[o + 2] = color[2];
        png.data[o + 3] = color[3];
      }
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

/** A default {@link VisualCheck} for a touched module; override any field. */
export function fixtureCheck(overrides: Partial<VisualCheck> = {}): VisualCheck {
  return {
    module: 'apps/checkout',
    url: 'https://preview.test/apps/checkout',
    viewport: { name: 'desktop', width: 8, height: 8 },
    theme: 'light',
    ...overrides,
  };
}

export interface FixtureShotOptions extends MakePngOptions {
  check?: VisualCheck;
  width?: number;
  height?: number;
}

/** A captured {@link VisualShot} carrying a real (tiny) PNG so `pixelDiff` runs for real. */
export function fixtureShot(opts: FixtureShotOptions = {}): VisualShot {
  const check = opts.check ?? fixtureCheck();
  const width = opts.width ?? 8;
  const height = opts.height ?? 8;
  const pngOpts: MakePngOptions = {};
  if (opts.fill) pngOpts.fill = opts.fill;
  if (opts.patch) pngOpts.patch = opts.patch;
  const png = makePng(width, height, pngOpts);
  return { check, png, width, height };
}

export interface FakeVisualEngine extends VisualEngine {
  captured: VisualCheck[];
  closed: number;
}

/**
 * A `VisualEngine` that returns canned shots. `shotFor` maps a check to its shot (defaulting to a
 * solid white 8×8); it records every captured check and how many times `close` was called.
 */
export function fakeVisualEngine(shotFor?: (check: VisualCheck) => VisualShot): FakeVisualEngine {
  const captured: VisualCheck[] = [];
  return {
    name: 'fake-visual',
    captured,
    closed: 0,
    async capture(check: VisualCheck): Promise<VisualShot> {
      captured.push(check);
      return shotFor ? shotFor(check) : fixtureShot({ check });
    },
    async close(): Promise<void> {
      this.closed += 1;
    },
  };
}

export interface PutPendingCall {
  key: VisualBaselineKey;
  sourceSha: string;
}
export interface ApproveCall {
  key: VisualBaselineKey;
  approvedBy: string;
}

export interface FakeBaselineStore extends VisualBaselineStore {
  /** Pre-populate a committed (already-approved) baseline from a shot's bytes. */
  seed(key: VisualBaselineKey, shot: VisualShot, sourceSha?: string): void;
  putPendingCalls: PutPendingCall[];
  approveCalls: ApproveCall[];
}

interface StoredEntry {
  baseline: VisualBaseline;
  bytes: Uint8Array;
}

/** An in-memory {@link VisualBaselineStore}: committed + pending maps, with recorded mutations. */
export function fakeBaselineStore(opts: { now?: () => string } = {}): FakeBaselineStore {
  const now = opts.now ?? (() => '2026-07-08T00:00:00.000Z');
  const committed = new Map<string, StoredEntry>();
  const pending = new Map<string, StoredEntry>();
  const bytesByPath = new Map<string, Uint8Array>();
  const putPendingCalls: PutPendingCall[] = [];
  const approveCalls: ApproveCall[] = [];

  const committedPath = (key: VisualBaselineKey): string => `baselines/${keySlug(key)}.png`;
  const pendingPath = (key: VisualBaselineKey): string => `baselines/.pending/${keySlug(key)}.png`;

  return {
    putPendingCalls,
    approveCalls,
    seed(key, shot, sourceSha = 'seed-sha'): void {
      const path = committedPath(key);
      bytesByPath.set(path, shot.png);
      committed.set(keySlug(key), {
        baseline: { key, path, width: shot.width, height: shot.height, sourceSha },
        bytes: shot.png,
      });
    },
    async get(key): Promise<VisualBaseline | null> {
      return committed.get(keySlug(key))?.baseline ?? null;
    },
    async read(baseline): Promise<Uint8Array> {
      const bytes = bytesByPath.get(baseline.path);
      if (!bytes) throw new Error(`fakeBaselineStore: no bytes for ${baseline.path}`);
      return bytes;
    },
    async putPending(key, shot, sourceSha): Promise<VisualBaseline> {
      putPendingCalls.push({ key, sourceSha });
      const path = pendingPath(key);
      bytesByPath.set(path, shot.png);
      const baseline: VisualBaseline = {
        key,
        path,
        width: shot.width,
        height: shot.height,
        sourceSha,
      };
      pending.set(keySlug(key), { baseline, bytes: shot.png });
      return baseline;
    },
    async approve(key, approvedBy): Promise<VisualBaseline> {
      approveCalls.push({ key, approvedBy });
      const entry = pending.get(keySlug(key));
      if (!entry) throw new Error(`fakeBaselineStore: no pending baseline for ${keySlug(key)}`);
      const path = committedPath(key);
      bytesByPath.set(path, entry.bytes);
      const baseline: VisualBaseline = {
        ...entry.baseline,
        path,
        approvedBy,
        approvedAt: now(),
      };
      committed.set(keySlug(key), { baseline, bytes: entry.bytes });
      pending.delete(keySlug(key));
      return baseline;
    },
    async list(module): Promise<VisualBaseline[]> {
      const all = [...committed.values()].map((e) => e.baseline);
      return module ? all.filter((b) => b.key.module === module) : all;
    },
  };
}

export interface MemArtifactSink extends VisualArtifactSink {
  files: Map<string, Uint8Array>;
}

/** In-memory {@link VisualArtifactSink}; records each write under an `artifacts/` prefix. */
export function memArtifactSink(): MemArtifactSink {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async write(relPath, bytes): Promise<string> {
      const path = `artifacts/${relPath}`;
      files.set(path, bytes);
      return path;
    },
  };
}

/** In-memory {@link VisualFs} for exercising the `GitBaselineStore` without disk. */
export function memVisualFs(): VisualFs {
  const files = new Map<string, Uint8Array>();
  return {
    async readFile(path): Promise<Uint8Array | null> {
      return files.get(path) ?? null;
    },
    async writeFile(path, data): Promise<void> {
      files.set(path, data);
    },
    async readText(path): Promise<string | null> {
      const bytes = files.get(path);
      return bytes ? Buffer.from(bytes).toString('utf-8') : null;
    },
    async writeText(path, data): Promise<void> {
      files.set(path, new Uint8Array(Buffer.from(data, 'utf-8')));
    },
    async mkdirp(): Promise<void> {
      // no-op: the map has no directories
    },
  };
}

export interface FakeVisionProvider extends LLMProvider {
  imageCalls: { prompt: string; images: ImagePart[] }[];
}

export interface FakeVisionProviderOptions {
  classification?: 'meaningful' | 'render-noise';
  confidence?: number;
  rationale?: string;
  /** Raw override returned verbatim from `generateWithImages` (to test parsing). */
  raw?: string;
}

/** An `LLMProvider` whose `generateWithImages` returns a canned visual verdict JSON. */
export function fakeVisionProvider(opts: FakeVisionProviderOptions = {}): FakeVisionProvider {
  const imageCalls: { prompt: string; images: ImagePart[] }[] = [];
  const verdict = JSON.stringify({
    classification: opts.classification ?? 'meaningful',
    confidence: opts.confidence ?? 0.9,
    rationale: opts.rationale ?? 'canned verdict',
  });
  return {
    name: 'fake-vision',
    imageCalls,
    async generateText(): Promise<string> {
      return '';
    },
    async generateWithTools(_prompt: string, _tools: Tool[]): Promise<ToolCallResult> {
      return { toolCalls: [], raw: null };
    },
    async generateWithImages(
      prompt: string,
      images: ImagePart[],
      _options?: GenerateOptions,
    ): Promise<string> {
      imageCalls.push({ prompt, images });
      return opts.raw ?? verdict;
    },
  };
}
