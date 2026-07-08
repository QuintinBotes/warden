import type { RecordedSession, TrafficStore } from '@warden/core';

/**
 * `fsTrafficStore` — a filesystem-backed {@link TrafficStore} for scrubbed sessions. It writes one
 * JSON file per session, each stamped with its stored-at time so `prune(ttlDays)` can enforce the
 * documented retention window. The filesystem and clock are injected (defaulting to
 * `node:fs/promises` and `Date`), so the store is hermetically unit-testable with an in-memory fs
 * and a fixed clock — no real disk or wall-clock needed.
 *
 * Only ever fed scrubbed `RecordedSession`s: the pipeline never persists a `RawTrafficSession`.
 */
export interface TrafficStoreFs {
  readdir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
}

export interface FsTrafficStoreOptions {
  dir: string;
  fs?: TrafficStoreFs;
  now?: () => Date;
}

interface StoredRecord {
  storedAt: string; // ISO
  session: { url: string; startedAt: string; steps: RecordedSession['steps'] };
}

/** Node `fs/promises`-backed adapter. Imported lazily so the store stays usable in a bundler. */
async function nodeFs(): Promise<TrafficStoreFs> {
  const fsp = await import('node:fs/promises');
  return {
    readdir: (dir) => fsp.readdir(dir),
    readFile: (path) => fsp.readFile(path, 'utf8'),
    writeFile: (path, data) => fsp.writeFile(path, data, 'utf8'),
    unlink: (path) => fsp.unlink(path),
    mkdir: async (dir) => {
      await fsp.mkdir(dir, { recursive: true });
    },
  };
}

function reviveSession(record: StoredRecord): RecordedSession {
  return {
    url: record.session.url,
    startedAt: new Date(record.session.startedAt),
    steps: record.session.steps,
  };
}

let counter = 0;

export function fsTrafficStore(opts: FsTrafficStoreOptions): TrafficStore {
  const dir = opts.dir.replace(/\/+$/, '');
  const now = opts.now ?? (() => new Date());
  const fsPromise = opts.fs ? Promise.resolve(opts.fs) : nodeFs();

  async function listRecords(
    fs: TrafficStoreFs,
  ): Promise<{ file: string; record: StoredRecord }[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: { file: string; record: StoredRecord }[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = `${dir}/${name}`;
      try {
        out.push({ file, record: JSON.parse(await fs.readFile(file)) as StoredRecord });
      } catch {
        // Skip unreadable/corrupt entries rather than fail the whole run.
      }
    }
    return out;
  }

  return {
    async put(session: RecordedSession): Promise<void> {
      const fs = await fsPromise;
      await fs.mkdir(dir);
      const storedAt = now().toISOString();
      counter += 1;
      const name = `${storedAt.replace(/[:.]/g, '-')}-${counter}.json`;
      const record: StoredRecord = {
        storedAt,
        session: {
          url: session.url,
          startedAt: session.startedAt.toISOString(),
          steps: session.steps,
        },
      };
      await fs.writeFile(`${dir}/${name}`, JSON.stringify(record));
    },

    async list(): Promise<RecordedSession[]> {
      const fs = await fsPromise;
      const records = await listRecords(fs);
      return records.map(({ record }) => reviveSession(record));
    },

    async prune(ttlDays: number): Promise<number> {
      const fs = await fsPromise;
      const cutoff = now().getTime() - ttlDays * 24 * 60 * 60 * 1000;
      const records = await listRecords(fs);
      let pruned = 0;
      for (const { file, record } of records) {
        if (new Date(record.storedAt).getTime() < cutoff) {
          await fs.unlink(file);
          pruned += 1;
        }
      }
      return pruned;
    },
  };
}
