import { load as loadYaml } from 'js-yaml';
import {
  WardenError,
  type FixtureBackend,
  type FixtureContainerSpec,
  type FixtureDef,
  type FixtureRecord,
} from '@warden/core';

/**
 * `FixtureRegistry` — loads, validates, and tag-indexes `FixtureDef`s (authored as
 * `tests/fixtures/*.yaml`). Parsing/validation are pure (given raw YAML strings) so the registry
 * is fully unit-testable without touching the filesystem; a thin injected reader
 * ({@link FixtureFileReader}) supplies the file contents in production.
 */

const BACKENDS: readonly FixtureBackend[] = ['sql', 'api', 'testcontainers'];

/** A single fixture YAML file: its path (for error messages) and raw contents. */
export interface FixtureSource {
  path: string;
  content: string;
}

function fail(source: string, message: string): never {
  throw new WardenError(`Invalid fixture in ${source}: ${message}`, 'E_FIXTURE_INVALID');
}

function asRecord(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(source, 'expected a mapping');
  }
  return value as Record<string, unknown>;
}

function coerceProvides(value: unknown, source: string): FixtureRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(source, '`provides` must be a list');
  return value.map((raw, i) => {
    const rec = asRecord(raw, `${source}.provides[${i}]`);
    if (typeof rec.entity !== 'string')
      fail(`${source}.provides[${i}]`, '`entity` must be a string');
    if (typeof rec.key !== 'string') fail(`${source}.provides[${i}]`, '`key` must be a string');
    const fields = asRecord(rec.fields ?? {}, `${source}.provides[${i}].fields`);
    const coerced: FixtureRecord['fields'] = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
        coerced[k] = v as string | number | boolean | null;
      } else {
        fail(
          `${source}.provides[${i}].fields.${k}`,
          'field values must be string/number/boolean/null',
        );
      }
    }
    return { entity: rec.entity, key: rec.key, fields: coerced };
  });
}

function coerceContainer(value: unknown, source: string): FixtureContainerSpec | undefined {
  if (value === undefined) return undefined;
  const rec = asRecord(value, `${source}.container`);
  if (typeof rec.image !== 'string') fail(`${source}.container`, '`image` must be a string');
  if (typeof rec.port !== 'number') fail(`${source}.container`, '`port` must be a number');
  const spec: FixtureContainerSpec = { image: rec.image, port: rec.port };
  if (typeof rec.healthCheckUrl === 'string') spec.healthCheckUrl = rec.healthCheckUrl;
  return spec;
}

function coerceDef(raw: unknown, source: string): FixtureDef {
  const rec = asRecord(raw, source);
  if (typeof rec.id !== 'string' || rec.id.length === 0)
    fail(source, '`id` must be a non-empty string');
  const id = rec.id;
  if (!Array.isArray(rec.appliesTo) || rec.appliesTo.some((t) => typeof t !== 'string')) {
    fail(source, '`appliesTo` must be a list of strings');
  }
  const backend = rec.backend;
  if (typeof backend !== 'string' || !BACKENDS.includes(backend as FixtureBackend)) {
    fail(source, `\`backend\` must be one of ${BACKENDS.join(', ')}`);
  }
  if (typeof rec.seed !== 'string') fail(source, '`seed` must be a string');
  if (typeof rec.teardown !== 'string') fail(source, '`teardown` must be a string');
  const def: FixtureDef = {
    id,
    appliesTo: rec.appliesTo as string[],
    backend: backend as FixtureBackend,
    seed: rec.seed,
    teardown: rec.teardown,
    provides: coerceProvides(rec.provides, source),
  };
  const container = coerceContainer(rec.container, source);
  if (container) def.container = container;
  return def;
}

/** Parses one fixture YAML document (a single def or a list of defs) into `FixtureDef[]`. */
export function parseFixtureDefs(content: string, source = '<inline>'): FixtureDef[] {
  // js-yaml 5 throws on empty input (v4 returned undefined); treat empty/whitespace as no fixtures.
  if (content.trim() === '') return [];
  let doc: unknown;
  try {
    doc = loadYaml(content);
  } catch (err) {
    throw new WardenError(
      `Invalid fixture YAML in ${source}: ${(err as Error).message}`,
      'E_FIXTURE_INVALID',
    );
  }
  if (doc === null || doc === undefined) return [];
  const list = Array.isArray(doc) ? doc : [doc];
  return list.map((raw, i) => coerceDef(raw, `${source}[${i}]`));
}

export class FixtureRegistry {
  private readonly defs: FixtureDef[];
  private readonly byTag: Map<string, FixtureDef[]>;

  constructor(defs: FixtureDef[]) {
    this.defs = defs;
    this.byTag = new Map();
    for (const def of defs) {
      for (const tag of def.appliesTo) {
        const bucket = this.byTag.get(tag);
        if (bucket) bucket.push(def);
        else this.byTag.set(tag, [def]);
      }
    }
  }

  /** Builds a registry from raw YAML sources, rejecting duplicate fixture ids across files. */
  static fromSources(sources: FixtureSource[]): FixtureRegistry {
    const defs: FixtureDef[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      for (const def of parseFixtureDefs(source.content, source.path)) {
        if (seen.has(def.id)) {
          throw new WardenError(
            `Duplicate fixture id "${def.id}" (in ${source.path})`,
            'E_FIXTURE_INVALID',
          );
        }
        seen.add(def.id);
        defs.push(def);
      }
    }
    return new FixtureRegistry(defs);
  }

  /** All loaded defs, in declared order. */
  all(): FixtureDef[] {
    return [...this.defs];
  }

  /** Defs that declare `tag` in their `appliesTo`. */
  forTag(tag: string): FixtureDef[] {
    return [...(this.byTag.get(tag) ?? [])];
  }

  /** Defs whose `appliesTo` intersects `tags`, de-duplicated and kept in declared order. */
  forTags(tags: string[]): FixtureDef[] {
    const wanted = new Set(tags);
    const result: FixtureDef[] = [];
    const seen = new Set<string>();
    for (const def of this.defs) {
      if (seen.has(def.id)) continue;
      if (def.appliesTo.some((tag) => wanted.has(tag))) {
        seen.add(def.id);
        result.push(def);
      }
    }
    return result;
  }

  /** The tag → defs index (a copy, so callers can't mutate the registry). */
  index(): Map<string, FixtureDef[]> {
    const copy = new Map<string, FixtureDef[]>();
    for (const [tag, defs] of this.byTag) copy.set(tag, [...defs]);
    return copy;
  }
}

/** Reads fixture YAML files from a directory. Injected so the registry stays hermetic in tests. */
export interface FixtureFileReader {
  /** Lists candidate file paths in `dir` (yaml filtering is applied by the loader). */
  list(dir: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

/** Default `FixtureFileReader` backed by `node:fs/promises` (used in production, not in tests). */
export function nodeFixtureFileReader(): FixtureFileReader {
  return {
    async list(dir) {
      const { readdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => join(dir, e.name));
    },
    async read(path) {
      const { readFile } = await import('node:fs/promises');
      return readFile(path, 'utf8');
    },
  };
}

/** Loads and indexes every `*.yaml`/`*.yml` file in `dir` via an injected reader. */
export async function loadFixtureRegistry(
  dir: string,
  reader: FixtureFileReader = nodeFixtureFileReader(),
): Promise<FixtureRegistry> {
  const files = (await reader.list(dir)).filter((f) => /\.ya?ml$/i.test(f)).sort();
  const sources: FixtureSource[] = [];
  for (const path of files) {
    sources.push({ path, content: await reader.read(path) });
  }
  return FixtureRegistry.fromSources(sources);
}
