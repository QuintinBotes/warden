import { load } from 'js-yaml';
import { TestCaseSchema, type FileAccess, type TestCase, type TestRepoLink } from '@warden/core';

/** The test-side inventory for a single target repo: parsed cases + a spec-file index. */
export interface TestInventory {
  cases: TestCase[];
  specFiles: string[];
}

const YAML_RE = /\.ya?ml$/i;
const SPEC_RE = /\.(spec|test)\.tsx?$/i;

/**
 * Read a target repo's test inventory over an injected {@link FileAccess}.
 *
 * Lists everything under `link.pathPrefix` (repo root when unset), parses each
 * `*.yaml`/`*.yml` file and validates it as a {@link TestCase} (invalid or
 * non-case YAML is skipped, never thrown — a target repo we don't own must not
 * be able to abort the run), and indexes every `*.spec.ts`/`*.test.ts` path.
 * Results are sorted for deterministic downstream analysis.
 */
export async function readTestInventory(
  link: TestRepoLink,
  fileAccess: FileAccess,
): Promise<TestInventory> {
  const dir = link.pathPrefix ?? '';
  const paths = [...(await fileAccess.listFiles(dir))].sort();

  const cases: TestCase[] = [];
  const specFiles: string[] = [];

  for (const path of paths) {
    if (SPEC_RE.test(path)) {
      specFiles.push(path);
      continue;
    }
    if (!YAML_RE.test(path)) continue;

    const raw = await fileAccess.readFile(path);
    if (raw == null) continue;

    let parsed: unknown;
    try {
      parsed = load(raw);
    } catch {
      continue;
    }
    const result = TestCaseSchema.safeParse(parsed);
    if (result.success) cases.push(result.data);
  }

  return { cases, specFiles };
}
