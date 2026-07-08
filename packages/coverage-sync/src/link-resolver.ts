import type { DocRepoLink, RepoLinks, TestRepoLink, WardenConfig } from '@warden/core';

/**
 * Resolve the linked repos declared by a source repo's `warden.config`.
 *
 * Pure: it reads `cfg.links`, rewrites any `repo === 'self'` to the concrete
 * `sourceRepo`, and returns fresh arrays (never aliases into `cfg`). Test, doc,
 * and dependent links are all resolved so downstream units never have to think
 * about the `self` sentinel again.
 */
export function resolveLinks(sourceRepo: string, cfg: WardenConfig): RepoLinks {
  const links = cfg.links;
  const resolve = (repo: string): string => (repo === 'self' ? sourceRepo : repo);

  const testRepos: TestRepoLink[] = links.testRepos.map((link) => ({
    ...link,
    repo: resolve(link.repo),
  }));

  const docRepos: DocRepoLink[] = links.docRepos.map((link) => ({
    ...link,
    repo: resolve(link.repo),
  }));

  const dependents: string[] = links.dependents.map(resolve);

  return { testRepos, docRepos, dependents };
}
