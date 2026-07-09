import { defineConfig } from 'tsup';

// This package is a GitHub Action, not a library: `action.yml` runs `dist/index.js`
// directly from a checkout with no `node_modules`. So the build bundles EVERYTHING
// (workspace + npm deps) into a single self-contained file, and that `dist/` is
// committed (see the root .gitignore exception + the CI freshness guard).
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  noExternal: [/.*/], // inline every dependency
  splitting: false, // one self-contained dist/index.js — simpler to commit + diff
  dts: false, // an executable, not a consumed type surface
  sourcemap: false, // keep the committed bundle lean
  clean: true,
});
