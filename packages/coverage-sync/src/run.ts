import type {
  ChangeSurface,
  CoverageGap,
  CoverageRecommender,
  DiffFile,
  FileAccess,
  GitHubAccess,
  LLMProvider,
  PrRef,
  Recommendation,
  WardenConfig,
} from '@warden/core';
import { resolveLinks } from './link-resolver.js';
import { readTestInventory, type TestInventory } from './test-inventory.js';
import { readDocInventory, type DocInventory } from './doc-inventory.js';
import { analyzeGaps } from './gap-analyzer.js';
import { publish } from './publisher.js';

const CHECK_TITLE = 'Warden coverage sync';

/** Everything `runCoverageSync` needs, with every external collaborator injected. */
export interface RunCoverageSyncInput {
  sourcePr: PrRef;
  sourceRepo: string;
  diff: DiffFile[];
  cfg: WardenConfig;
  /** Build a read accessor for a given target repo (`self` already resolved to the source repo). */
  fileAccessFor: (repo: string) => FileAccess;
  gh: GitHubAccess;
  recommender: CoverageRecommender;
  provider: LLMProvider;
  /**
   * Change-surface computer. Injectable so the pipeline is hermetic (and can reuse
   * `@warden/orchestrator`'s `computeChangeSurface`); defaults to a local heuristic.
   */
  computeChangeSurface?: (diff: DiffFile[], cfg: WardenConfig) => ChangeSurface;
}

/** The outcome of a coverage-sync run. */
export interface CoverageSyncSummary {
  status: 'no-links' | 'no-gaps' | 'published';
  changeSurface: ChangeSurface;
  gaps: CoverageGap[];
  recommendations: Recommendation[];
  draftPrs: { repo: string; url: string; number: number }[];
  selfSuggested: number;
  checkPosted: boolean;
}

/**
 * The cross-repo coverage-sync pipeline, wired from injected collaborators.
 *
 * `computeChangeSurface` → `resolveLinks` → read test/doc inventories per link →
 * `analyzeGaps` → `recommender.recommend` → `publish`. When there are no links,
 * or no gaps, it posts a single neutral check run and returns early without
 * opening any PRs.
 */
export async function runCoverageSync(input: RunCoverageSyncInput): Promise<CoverageSyncSummary> {
  const compute = input.computeChangeSurface ?? defaultComputeChangeSurface;
  const changeSurface = compute(input.diff, input.cfg);
  const links = resolveLinks(input.sourceRepo, input.cfg);

  const hasLinks =
    links.testRepos.length > 0 || links.docRepos.length > 0 || links.dependents.length > 0;

  if (!hasLinks) {
    await input.gh.postCheckRun(
      input.sourcePr,
      'neutral',
      CHECK_TITLE,
      'No linked repos configured; nothing to sync.',
    );
    return emptySummary('no-links', changeSurface);
  }

  // Dependents are repos whose tests exercise THIS repo — read them as test repos too.
  const testLinks = [...links.testRepos, ...links.dependents.map((repo) => ({ repo }))];

  const testInv: TestInventory = { cases: [], specFiles: [] };
  for (const link of testLinks) {
    const inv = await readTestInventory(link, input.fileAccessFor(link.repo));
    testInv.cases.push(...inv.cases);
    testInv.specFiles.push(...inv.specFiles);
  }

  const docInv: DocInventory = { docFiles: [], openapiFiles: [] };
  for (const link of links.docRepos) {
    const inv = await readDocInventory(link, input.fileAccessFor(link.repo));
    docInv.docFiles.push(...inv.docFiles);
    docInv.openapiFiles.push(...inv.openapiFiles);
  }

  const removedSubjects = removedSubjectsFromDiff(input.diff);
  const gaps = analyzeGaps(changeSurface, testInv, docInv, input.cfg, removedSubjects);

  if (gaps.length === 0) {
    await input.gh.postCheckRun(
      input.sourcePr,
      'neutral',
      CHECK_TITLE,
      'No coverage or documentation gaps found.',
    );
    return { ...emptySummary('no-gaps', changeSurface), gaps };
  }

  const recommendations = await input.recommender.recommend({
    changeSurface,
    diff: input.diff,
    gaps,
    provider: input.provider,
    cfg: input.cfg,
  });

  const { draftPrs, selfSuggested } = await publish(recommendations, input.sourcePr, input.gh);

  return {
    status: 'published',
    changeSurface,
    gaps,
    recommendations,
    draftPrs,
    selfSuggested,
    checkPosted: true,
  };
}

function emptySummary(
  status: CoverageSyncSummary['status'],
  changeSurface: ChangeSurface,
): CoverageSyncSummary {
  return {
    status,
    changeSurface,
    gaps: [],
    recommendations: [],
    draftPrs: [],
    selfSuggested: 0,
    checkPosted: true,
  };
}

/** Subjects deleted by the diff, used to drive orphaned-test/doc detection. */
function removedSubjectsFromDiff(diff: DiffFile[]): string[] {
  const out = new Set<string>();
  for (const file of diff) {
    if (file.status !== 'deleted' && file.status !== 'renamed') continue;
    for (const subject of subjectsFromPath(file.path)) out.add(subject);
  }
  return [...out];
}

/** Candidate subject tokens for a path: the path itself, its module, and its basename. */
function subjectsFromPath(path: string): string[] {
  const subjects = new Set<string>([path]);
  const base = path
    .replace(/\.[^./]+$/, '')
    .split('/')
    .filter((segment) => segment.length > 0)
    .pop();
  if (base) subjects.add(base);
  const mod = moduleOf(path);
  if (mod) subjects.add(mod);
  return [...subjects];
}

function moduleOf(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const first = segments[0];
  const second = segments[1];
  if (first && second && ['apps', 'packages', 'services', 'src'].includes(first)) {
    return `${first}/${second}`;
  }
  return first ?? '';
}

/**
 * A minimal, dependency-free change surface used when no `computeChangeSurface`
 * is injected. Faithful enough to drive gap analysis; production callers inject
 * `@warden/orchestrator`'s richer implementation.
 */
function defaultComputeChangeSurface(diff: DiffFile[], _cfg: WardenConfig): ChangeSurface {
  const changedFiles = diff.map((file) => file.path);
  const changedModules = [
    ...new Set(diff.map((file) => moduleOf(file.path)).filter((mod) => mod.length > 0)),
  ];
  const affectedApiRoutes = [
    ...new Set(diff.filter((file) => /(^|\/)(api|routes)\//i.test(file.path)).map((f) => f.path)),
  ];
  const affectedComponents = [
    ...new Set(
      diff
        .filter(
          (file) =>
            /\.(tsx|jsx|vue|svelte)$/i.test(file.path) || /(^|\/)components\//i.test(file.path),
        )
        .map((file) => file.path),
    ),
  ];
  const hasSharedChanges = changedFiles.some((path) => /shared|common/i.test(path));

  return {
    changedFiles,
    changedModules,
    testTags: [],
    hasSharedChanges,
    affectedApiRoutes,
    affectedComponents,
    riskScore: 0,
    riskReasons: [],
  };
}
