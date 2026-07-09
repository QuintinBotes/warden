import type { CoverageIndex } from '@warden/core';
import type { CoverageFileAccess } from './load-coverage-index.js';

/**
 * In-memory doubles for this package's hermetic unit tests (never bundled into `dist` — they are
 * unreachable from the `index.ts` entry). Same hand-written style as `@warden/cuj`'s
 * `testing-fakes`.
 */

/** A small, realistic {@link CoverageIndex}; pass `entries` to replace it wholesale. */
export function fixtureCoverageIndex(entries?: CoverageIndex): CoverageIndex {
  return (
    entries ?? [
      {
        testId: 'TC-checkout',
        testName: 'guest checkout',
        files: ['apps/checkout/page.tsx', 'lib/cart.ts'],
      },
      { testId: 'TC-cart', testName: 'add to cart', files: ['lib/cart.ts'] },
      { testId: 'TC-profile', testName: 'edit profile', files: ['apps/profile/page.tsx'] },
    ]
  );
}

/** A {@link CoverageFileAccess} backed by a `path -> raw text` map; unknown paths read as `null`. */
export function memFileAccess(files: Record<string, string>): CoverageFileAccess {
  return {
    async readFile(path: string): Promise<string | null> {
      return Object.prototype.hasOwnProperty.call(files, path) ? files[path]! : null;
    },
  };
}
