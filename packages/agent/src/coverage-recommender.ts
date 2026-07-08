import type {
  ChangeSurface,
  CoverageGap,
  CoverageRecommender,
  DiffFile,
  LLMProvider,
  Recommendation,
  RecommendationAction,
  RepoTarget,
  WardenConfig,
} from '@warden/core';
import { asRecord, slugify, summarizeChange } from './strategy-support';

/**
 * A {@link CoverageGap} enriched with the extra context the analyzer (WS-coverage-sync)
 * can attach. The {@link CoverageRecommender} reads these fields structurally, so a plain
 * `CoverageGap` works too — this interface only exists so callers get type help when they
 * do have the extra signals.
 */
export interface CoverageGapInput extends CoverageGap {
  /** The repo the resulting change targets (`'self'` or `'owner/repo'`). */
  targetRepo?: RepoTarget;
  /** Requirement ids this gap traces to, for recommendation traceability. */
  requirementIds?: string[];
}

/**
 * System prompt for test recommendations. Mirrors the generative/healer strategies: the
 * model writes a tagged Playwright spec (add), a minimal unified diff that re-aligns an
 * existing spec with the new behavior (update), or a deletion diff for a dead test (remove).
 */
export const COVERAGE_TEST_SYSTEM_PROMPT = `You keep a repository's Playwright E2E tests in sync with a code change.
You are given ONE coverage gap and the change that caused it. Respond with ONLY the artifact — no prose.

- add (uncovered): write a complete Playwright spec that covers the subject. Use role-based
  locators (getByRole/getByLabel/getByText), assert the happy path and at least one negative
  case, and tag the test @smoke for a critical path or @regression otherwise.
- update (changed): output a minimal unified diff (---/+++/@@) that updates the existing spec so
  it asserts the NEW behavior instead of the old.
- remove (orphaned): output a unified diff that deletes the obsolete test.`;

/**
 * System prompt for documentation recommendations: draft a new Markdown section (add),
 * a minimal unified diff correcting a stale doc (update), or a deletion diff (remove).
 */
export const COVERAGE_DOC_SYSTEM_PROMPT = `You keep a repository's documentation in sync with a code change.
You are given ONE documentation gap and the change that caused it. Respond with ONLY the artifact — no prose.

- add (uncovered): write the new documentation section in Markdown (a heading plus the body,
  and, for an API surface, the request/response or config it introduces).
- update (changed): output a minimal unified diff (---/+++/@@) that corrects the doc to match
  the new behavior/signature/config.
- remove (orphaned): output a unified diff that deletes the stale documentation.`;

/** Factory for the cross-repo coverage {@link CoverageRecommender} (add / update / remove). */
export function createCoverageRecommender(): CoverageRecommender {
  return {
    async recommend(input): Promise<Recommendation[]> {
      const { changeSurface, diff, gaps, provider, cfg } = input;
      const recommendations: Recommendation[] = [];
      for (const gap of gaps) {
        recommendations.push(await recommendForGap(gap, changeSurface, diff, provider, cfg));
      }
      return recommendations;
    },
  };
}

async function recommendForGap(
  gap: CoverageGap,
  changeSurface: ChangeSurface,
  diff: DiffFile[],
  provider: LLMProvider,
  cfg: WardenConfig,
): Promise<Recommendation> {
  const action = actionForType(gap.type);
  const { repo, path: relPath } = resolveTarget(gap);
  const path = targetPath(gap, action, relPath);

  const prompt = buildGapPrompt(gap, action, path, changeSurface, diff);
  const systemPrompt =
    gap.kind === 'test' ? COVERAGE_TEST_SYSTEM_PROMPT : COVERAGE_DOC_SYSTEM_PROMPT;
  const raw = await provider.generateText(prompt, { systemPrompt, model: cfg.ai.model });

  const recommendation: Recommendation = {
    kind: gap.kind,
    action,
    targetRepo: repo,
    path,
    reason: buildReason(gap, action, changeSurface),
  };

  const requirementIds = collectRequirementIds(changeSurface, gap);
  if (requirementIds) recommendation.requirementIds = requirementIds;

  if (action === 'add') {
    recommendation.content = deriveContent(raw, gap);
  } else {
    recommendation.patch = derivePatch(raw, gap, action, path);
  }

  return recommendation;
}

/** `uncovered → add`, `changed → update`, `orphaned → remove`. */
function actionForType(type: CoverageGap['type']): RecommendationAction {
  switch (type) {
    case 'uncovered':
      return 'add';
    case 'changed':
      return 'update';
    case 'orphaned':
      return 'remove';
    default:
      return 'update';
  }
}

/**
 * Works out which repo/path a gap points at. Precedence: an explicit `targetRepo` field on
 * the gap, then a repo-qualified `relatedPath` of the form `owner/repo:path` (or `self:path`),
 * otherwise `'self'` with the bare `relatedPath`.
 */
function resolveTarget(gap: CoverageGap): { repo: RepoTarget; path: string | undefined } {
  const record = asRecord(gap);
  const explicit = typeof record.targetRepo === 'string' ? record.targetRepo : undefined;
  const related = gap.relatedPath;

  const qualified = related ? parseQualifiedPath(related) : undefined;
  if (explicit) {
    return { repo: explicit, path: qualified ? qualified.path : related };
  }
  if (qualified) {
    return { repo: qualified.repo, path: qualified.path };
  }
  return { repo: 'self', path: related };
}

/** Parses `owner/repo:path` or `self:path` into its parts; returns undefined for a bare path. */
function parseQualifiedPath(value: string): { repo: RepoTarget; path: string } | undefined {
  const colon = value.indexOf(':');
  if (colon <= 0) return undefined;
  const repo = value.slice(0, colon);
  const path = value.slice(colon + 1);
  const looksLikeRepo = repo === 'self' || /^[\w.-]+\/[\w.-]+$/.test(repo);
  if (!looksLikeRepo || path.length === 0) return undefined;
  return { repo, path };
}

/** The file the recommendation touches: the related file for update/remove, a synthesized one for add. */
function targetPath(
  gap: CoverageGap,
  action: RecommendationAction,
  relPath: string | undefined,
): string {
  if (action !== 'add') {
    return relPath ?? synthesizePath(gap);
  }
  // For an `add` the related path usually points at the changed SOURCE file, not the artifact
  // we are creating — only reuse it when it is already the right kind of target file.
  if (relPath && isArtifactPath(gap.kind, relPath)) return relPath;
  return synthesizePath(gap);
}

function isArtifactPath(kind: CoverageGap['kind'], path: string): boolean {
  return kind === 'test' ? /\.spec\.[tj]sx?$/i.test(path) : /\.mdx?$/i.test(path);
}

function synthesizePath(gap: CoverageGap): string {
  const slug = slugify(gap.relatedPath ?? gap.subject);
  return gap.kind === 'test' ? `tests/e2e/${slug}.spec.ts` : `docs/${slug}.md`;
}

function buildGapPrompt(
  gap: CoverageGap,
  action: RecommendationAction,
  path: string,
  changeSurface: ChangeSurface,
  diff: DiffFile[],
): string {
  const lines = [
    `Keep the ${gap.kind} coverage in sync for this change.`,
    '',
    `Gap: ${gap.type} → ${action}.`,
    `Subject: ${gap.subject}`,
    `Detail: ${gap.detail}`,
  ];
  if (gap.relatedPath) lines.push(`Related file: ${gap.relatedPath}`);
  lines.push(
    `Target file: ${path}`,
    '',
    'Change under test:',
    summarizeChange(changeSurface, diff),
  );
  lines.push('', instructionFor(gap.kind, action, path));
  return lines.join('\n');
}

function instructionFor(
  kind: CoverageGap['kind'],
  action: RecommendationAction,
  path: string,
): string {
  if (kind === 'test') {
    if (action === 'add')
      return `Write the full, tagged Playwright spec for ${path}. Output only the file.`;
    if (action === 'update')
      return `Output a minimal unified diff updating ${path} to assert the new behavior.`;
    return `Output a unified diff that deletes the obsolete test ${path}.`;
  }
  if (action === 'add')
    return `Write the new Markdown documentation section for ${path}. Output only the section.`;
  if (action === 'update')
    return `Output a minimal unified diff updating ${path} to match the new behavior.`;
  return `Output a unified diff that removes the stale documentation ${path}.`;
}

/** A one-line justification tied to the change that motivated the gap. */
function buildReason(
  gap: CoverageGap,
  action: RecommendationAction,
  changeSurface: ChangeSurface,
): string {
  const change = primaryChange(changeSurface);
  const noun = gap.kind === 'test' ? 'test' : 'doc';
  switch (action) {
    case 'add':
      return `Add ${noun} for "${gap.subject}": uncovered by the change to ${change}.`;
    case 'update':
      return `Update ${noun} for "${gap.subject}": it still asserts the old behavior after ${change} changed.`;
    default:
      return `Remove ${noun} for "${gap.subject}": it references ${change} which was removed.`;
  }
}

function primaryChange(changeSurface: ChangeSurface): string {
  return (
    changeSurface.changedModules?.[0] ??
    changeSurface.changedFiles?.[0] ??
    changeSurface.affectedApiRoutes?.[0] ??
    'the change'
  );
}

/** Merges requirement ids attached to the change surface and to the gap (both read structurally). */
function collectRequirementIds(
  changeSurface: ChangeSurface,
  gap: CoverageGap,
): string[] | undefined {
  const ids = new Set<string>();
  for (const source of [asRecord(changeSurface).requirementIds, asRecord(gap).requirementIds]) {
    if (Array.isArray(source)) {
      for (const id of source) {
        if (typeof id === 'string' && id.length > 0) ids.add(id);
      }
    }
  }
  return ids.size > 0 ? [...ids] : undefined;
}

/** Full file contents for an `add`. Uses the model output when it produced any, else a sensible stub. */
function deriveContent(raw: string, gap: CoverageGap): string {
  const text = (raw ?? '').trim();
  if (gap.kind === 'test') {
    return ensureTagged(text.length > 0 ? text : stubSpec(gap));
  }
  return text.length > 0 ? `${text}\n`.replace(/\n+$/, '\n') : stubDoc(gap);
}

/** Guarantees a spec carries a Playwright tag so downstream tiering can pick it up. */
function ensureTagged(spec: string): string {
  if (/@smoke|@regression/.test(spec)) return spec;
  return `// @regression\n${spec}`;
}

function stubSpec(gap: CoverageGap): string {
  return [
    "import { test, expect } from '@playwright/test';",
    '',
    `test('@regression ${sanitizeTitle(gap.subject)}', async ({ page }) => {`,
    `  // TODO(warden): cover ${gap.detail}`,
    "  await page.goto('/');",
    '  await expect(page).toHaveTitle(/.*/);',
    '});',
    '',
  ].join('\n');
}

function stubDoc(gap: CoverageGap): string {
  return `## ${gap.subject}\n\n${gap.detail}\n`;
}

/** Unified diff for an `update` / `remove`. Uses the model's diff when it emitted one, else derives one. */
function derivePatch(
  raw: string,
  gap: CoverageGap,
  action: RecommendationAction,
  path: string,
): string {
  const text = (raw ?? '').trim();
  if (isUnifiedDiff(text)) return raw;
  return action === 'remove' ? deletionDiff(path) : updateDiff(path, text, gap);
}

function isUnifiedDiff(text: string): boolean {
  return /^(diff --git |--- |\+\+\+ |@@ )/m.test(text);
}

/** A minimal, reviewer-friendly update diff annotating the target file with the needed change. */
function updateDiff(path: string, note: string, gap: CoverageGap): string {
  const summary = firstLine(note.length > 0 ? note : `align with: ${gap.detail}`);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,0 +1,1 @@',
    `+// TODO(warden): ${summary}`,
    '',
  ].join('\n');
}

/** A deletion diff (target file → /dev/null) proposed for review, never auto-applied. */
function deletionDiff(path: string): string {
  return [`--- a/${path}`, '+++ /dev/null', '@@ -1,1 +0,0 @@', `-// obsolete: ${path}`, ''].join(
    '\n',
  );
}

function firstLine(value: string): string {
  return value.split('\n')[0]!.trim();
}

function sanitizeTitle(subject: string): string {
  return subject.replace(/'/g, '').replace(/\s+/g, ' ').trim() || 'change';
}
