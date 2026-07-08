import {
  WardenError,
  type VisualBaseline,
  type VisualBaselineKey,
  type VisualBaselineStore,
  type VisualShot,
} from '@warden/core';
import { keySlug } from './compare.js';

/**
 * Minimal injectable filesystem seam so {@link GitBaselineStore} is unit-testable without touching
 * disk. `read*` return `null` for a missing path; `writeText`/`writeFile` create parent dirs.
 */
export interface VisualFs {
  readFile(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, data: string): Promise<void>;
  mkdirp(dir: string): Promise<void>;
}

/** Options for {@link GitBaselineStore}. */
export interface GitBaselineStoreOptions {
  /** Directory baselines live under (e.g. `cfg.visual.baselinesDir`). */
  baselinesDir: string;
  /** Injected filesystem. Use {@link nodeVisualFs} in production. */
  fs: VisualFs;
  /** ISO-timestamp source, injected for deterministic tests. Defaults to `new Date().toISOString`. */
  now?: () => string;
}

interface StoredManifest {
  baselines: VisualBaseline[];
}

/**
 * Git-versioned baseline store backed by plain PNG files + a `baselines.json` manifest under
 * `baselinesDir`. Pending candidates live under `.pending/` (uncommitted) until `approve` promotes
 * them into the committed manifest, stamping `approvedBy` + `approvedAt`. Everything is a reviewable
 * Git diff — no external service.
 */
export class GitBaselineStore implements VisualBaselineStore {
  private readonly dir: string;
  private readonly fs: VisualFs;
  private readonly now: () => string;

  constructor(opts: GitBaselineStoreOptions) {
    this.dir = opts.baselinesDir.endsWith('/') ? opts.baselinesDir : `${opts.baselinesDir}/`;
    this.fs = opts.fs;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private manifestPath(): string {
    return `${this.dir}baselines.json`;
  }
  private pendingManifestPath(): string {
    return `${this.dir}.pending/pending.json`;
  }
  private committedPngPath(key: VisualBaselineKey): string {
    return `${this.dir}${keySlug(key)}.png`;
  }
  private pendingPngPath(key: VisualBaselineKey): string {
    return `${this.dir}.pending/${keySlug(key)}.png`;
  }

  private async readManifest(path: string): Promise<StoredManifest> {
    const raw = await this.fs.readText(path);
    if (!raw) return { baselines: [] };
    try {
      const parsed = JSON.parse(raw) as StoredManifest;
      return { baselines: Array.isArray(parsed.baselines) ? parsed.baselines : [] };
    } catch {
      return { baselines: [] };
    }
  }

  private async writeManifest(path: string, manifest: StoredManifest): Promise<void> {
    await this.fs.writeText(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  async get(key: VisualBaselineKey): Promise<VisualBaseline | null> {
    const { baselines } = await this.readManifest(this.manifestPath());
    return baselines.find((b) => sameKey(b.key, key)) ?? null;
  }

  async read(baseline: VisualBaseline): Promise<Uint8Array> {
    const bytes = await this.fs.readFile(baseline.path);
    if (!bytes) {
      throw new WardenError(
        `Visual baseline PNG not found at "${baseline.path}"`,
        'VISUAL_BASELINE_MISSING',
      );
    }
    return bytes;
  }

  async putPending(
    key: VisualBaselineKey,
    shot: VisualShot,
    sourceSha: string,
  ): Promise<VisualBaseline> {
    const path = this.pendingPngPath(key);
    await this.fs.writeFile(path, shot.png);

    const baseline: VisualBaseline = {
      key,
      path,
      width: shot.width,
      height: shot.height,
      sourceSha,
    };

    const manifest = await this.readManifest(this.pendingManifestPath());
    manifest.baselines = upsert(manifest.baselines, baseline);
    await this.writeManifest(this.pendingManifestPath(), manifest);
    return baseline;
  }

  async approve(key: VisualBaselineKey, approvedBy: string): Promise<VisualBaseline> {
    const pending = await this.readManifest(this.pendingManifestPath());
    const candidate = pending.baselines.find((b) => sameKey(b.key, key));
    if (!candidate) {
      throw new WardenError(
        `No pending visual baseline to approve for ${keySlug(key)}`,
        'VISUAL_NO_PENDING_BASELINE',
      );
    }

    const bytes = await this.read(candidate);
    const committedPath = this.committedPngPath(key);
    await this.fs.writeFile(committedPath, bytes);

    const approved: VisualBaseline = {
      key,
      path: committedPath,
      width: candidate.width,
      height: candidate.height,
      sourceSha: candidate.sourceSha,
      approvedBy,
      approvedAt: this.now(),
    };

    const committed = await this.readManifest(this.manifestPath());
    committed.baselines = upsert(committed.baselines, approved);
    await this.writeManifest(this.manifestPath(), committed);

    pending.baselines = pending.baselines.filter((b) => !sameKey(b.key, key));
    await this.writeManifest(this.pendingManifestPath(), pending);

    return approved;
  }

  async list(module?: string): Promise<VisualBaseline[]> {
    const { baselines } = await this.readManifest(this.manifestPath());
    return module ? baselines.filter((b) => b.key.module === module) : baselines;
  }
}

function sameKey(a: VisualBaselineKey, b: VisualBaselineKey): boolean {
  return a.module === b.module && a.viewport === b.viewport && a.theme === b.theme;
}

function upsert(list: VisualBaseline[], entry: VisualBaseline): VisualBaseline[] {
  const next = list.filter((b) => !sameKey(b.key, entry.key));
  next.push(entry);
  next.sort((l, r) => keySlug(l.key).localeCompare(keySlug(r.key)));
  return next;
}

/** Production {@link VisualFs} backed by `node:fs/promises`. Not used in unit tests. */
export function nodeVisualFs(): VisualFs {
  return {
    async readFile(path: string): Promise<Uint8Array | null> {
      const { readFile } = await import('node:fs/promises');
      try {
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
    async writeFile(path: string, data: Uint8Array): Promise<void> {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async readText(path: string): Promise<string | null> {
      const { readFile } = await import('node:fs/promises');
      try {
        return await readFile(path, 'utf-8');
      } catch {
        return null;
      }
    },
    async writeText(path: string, data: string): Promise<void> {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, 'utf-8');
    },
    async mkdirp(dir: string): Promise<void> {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
    },
  };
}
