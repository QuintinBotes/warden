import type { DocRepoLink, FileAccess } from '@warden/core';

/** The doc-side inventory for a single target repo: prose docs + OpenAPI specs. */
export interface DocInventory {
  docFiles: string[];
  openapiFiles: string[];
}

const DOC_RE = /\.mdx?$/i;
const OPENAPI_RE = /(^|\/)openapi\.(json|ya?ml)$/i;

/**
 * Read a target repo's documentation inventory over an injected {@link FileAccess}.
 *
 * Everything under `link.pathPrefix` (repo root when unset) is listed; Markdown /
 * MDX files become `docFiles` and any `openapi.{json,yaml,yml}` become
 * `openapiFiles`. File contents are not read here — the gap analyzer correlates
 * by path — so this stays cheap over the contents API. Paths are sorted.
 */
export async function readDocInventory(
  link: DocRepoLink,
  fileAccess: FileAccess,
): Promise<DocInventory> {
  const dir = link.pathPrefix ?? '';
  const paths = [...(await fileAccess.listFiles(dir))].sort();

  const docFiles = paths.filter((path) => DOC_RE.test(path));
  const openapiFiles = paths.filter((path) => OPENAPI_RE.test(path));

  return { docFiles, openapiFiles };
}
