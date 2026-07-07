/**
 * Filesystem seam. The studio never imports `node:fs` directly — it writes through an
 * injected {@link StudioWriter} so unit tests can capture every write in memory and never
 * touch a real disk. The default implementation is a thin wrapper over `node:fs/promises`.
 */
export interface StudioWriter {
  /** Ensure `dir` exists (recursively). */
  mkdir(dir: string): Promise<void>;
  /** Write UTF-8 text to `filePath`. */
  writeFile(filePath: string, data: string): Promise<void>;
}

/** Default {@link StudioWriter} backed by `node:fs/promises`. Never used in unit tests. */
export function defaultWriter(): StudioWriter {
  return {
    async mkdir(dir) {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
    },
    async writeFile(filePath, data) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, data, 'utf8');
    },
  };
}
