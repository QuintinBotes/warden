import { describe, expect, it } from 'vitest';
import { readDocInventory } from './doc-inventory.js';
import { memFileAccess } from './testing-fakes.js';

describe('readDocInventory', () => {
  it('collects Markdown/MDX docs and OpenAPI specs under the prefix', async () => {
    const tree = {
      'docs/checkout.md': '# Checkout',
      'docs/guide.mdx': 'x',
      'docs/openapi.yaml': 'openapi: 3.0.0',
      'docs/schema.json': '{}',
      'docs/logo.png': 'binary',
      'other/readme.md': 'ignored',
    };

    const inv = await readDocInventory({ repo: 'self', pathPrefix: 'docs/' }, memFileAccess(tree));

    expect(inv.docFiles).toEqual(['docs/checkout.md', 'docs/guide.mdx']);
    expect(inv.openapiFiles).toEqual(['docs/openapi.yaml']);
  });

  it('matches openapi.json and openapi.yml too', async () => {
    const tree = {
      'api/openapi.json': '{}',
      'api/v2/openapi.yml': 'openapi: 3.1.0',
      'api/notes.md': 'x',
    };

    const inv = await readDocInventory(
      { repo: 'org/portal', pathPrefix: 'api/' },
      memFileAccess(tree),
    );

    expect(inv.openapiFiles).toEqual(['api/openapi.json', 'api/v2/openapi.yml']);
    expect(inv.docFiles).toEqual(['api/notes.md']);
  });
});
