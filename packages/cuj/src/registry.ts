import { CujSchema, WardenError, type Cuj } from '@warden/core';
import type { CujParse, CujSource } from './ports.js';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

/** The outcome of loading a CUJ directory: the valid journeys, an index, and any skipped files. */
export interface CujRegistryResult {
  cujs: Cuj[];
  byId: Map<string, Cuj>;
  /** Every module/tag (CUJ `tags` + step `module`) → the journeys that span it. */
  byTag: Map<string, Cuj[]>;
  /** Malformed files that were skipped, each carrying an `E_CUJ_INVALID` `WardenError`. */
  errors: WardenError[];
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

/**
 * Loads, parses, validates, and indexes CUJ YAML definitions through an injected `CujSource`.
 * A malformed file raises a `WardenError('E_CUJ_INVALID')` that is *collected and skipped* — it
 * never crashes the run — so the surviving CUJs (and the whole run) still proceed. Callers
 * surface `result.errors` as WARN annotations.
 *
 * `parse` is injected (the CLI passes `js-yaml`'s `load`, tests pass `JSON.parse`) so the
 * package carries no YAML dependency of its own.
 */
export class CujRegistry {
  constructor(
    private readonly source: CujSource,
    private readonly parse: CujParse = JSON.parse,
  ) {}

  async load(dir: string): Promise<CujRegistryResult> {
    const all = await this.source.list(dir);
    const files = all.filter((path) => YAML_EXTENSIONS.has(extensionOf(path))).sort();

    const cujs: Cuj[] = [];
    const byId = new Map<string, Cuj>();
    const byTag = new Map<string, Cuj[]>();
    const errors: WardenError[] = [];

    for (const path of files) {
      let cuj: Cuj;
      try {
        const raw = await this.source.read(path);
        const parsed = this.parse(raw);
        const result = CujSchema.safeParse(parsed);
        if (!result.success) {
          errors.push(
            new WardenError(`Invalid CUJ in ${path}: ${result.error.message}`, 'E_CUJ_INVALID'),
          );
          continue;
        }
        cuj = result.data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          new WardenError(`Could not read/parse CUJ ${path}: ${message}`, 'E_CUJ_INVALID'),
        );
        continue;
      }

      if (byId.has(cuj.id)) {
        errors.push(new WardenError(`Duplicate CUJ id '${cuj.id}' in ${path}`, 'E_CUJ_INVALID'));
        continue;
      }

      cujs.push(cuj);
      byId.set(cuj.id, cuj);
      for (const tag of tagsOf(cuj)) {
        const list = byTag.get(tag) ?? [];
        list.push(cuj);
        byTag.set(tag, list);
      }
    }

    return { cujs, byId, byTag, errors };
  }
}

/** Every tag a CUJ spans: its own `tags` plus each step's `module`. */
export function tagsOf(cuj: Cuj): string[] {
  const tags = new Set<string>(cuj.tags);
  for (const step of cuj.steps) {
    if (step.module) tags.add(step.module);
  }
  return [...tags];
}
