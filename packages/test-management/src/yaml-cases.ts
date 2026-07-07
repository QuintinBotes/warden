import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { TestCaseSchema, WardenError, type TestCase } from '@warden/core';

const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);

/** Read every `*.yaml`/`*.yml` file in `dir` and validate it as a `TestCase`. */
export async function loadYamlCases(dir: string): Promise<TestCase[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const yamlFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => YAML_EXTENSIONS.has(name.slice(name.lastIndexOf('.'))))
    .sort();

  const cases: TestCase[] = [];
  for (const fileName of yamlFiles) {
    const filePath = join(dir, fileName);
    const raw = await readFile(filePath, 'utf8');
    const parsed = load(raw);
    const result = TestCaseSchema.safeParse(parsed);
    if (!result.success) {
      throw new WardenError(
        `Invalid test case in ${filePath}: ${result.error.message}`,
        'E_TEST_CASE_INVALID',
      );
    }
    cases.push(result.data);
  }
  return cases;
}
