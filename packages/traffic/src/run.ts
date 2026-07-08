import type {
  CandidateCUJ,
  CujProposer,
  GeneratedTest,
  GitHubAccess,
  JourneyCluster,
  JourneyClusterer,
  LLMProvider,
  PiiScrubber,
  RecordedSession,
  TestSynthesizer,
  TrafficSource,
  TrafficStore,
  WardenConfig,
} from '@warden/core';

/**
 * `runTraffic` — the production-traffic pipeline, wired entirely from injected collaborators:
 *
 *   consent-aware collect → **scrub (before store)** → store scrubbed only → prune (retention) →
 *   cluster → synthesize (reused `TestSynthesizer`) → propose CUJs → publish a **draft PR**.
 *
 * Every external dependency (source, store, scrubber, clusterer, synthesizer, proposer, provider,
 * GitHub) is passed in, so the whole engine is hermetically unit-testable with no live traffic,
 * browser, network, or LLM. It is strictly opt-in (`traffic.enabled`), never persists a raw
 * session, always prunes on retention, and never auto-merges — synthesized specs and CUJ proposals
 * only ever land as a draft PR for a human to review.
 */

/** Run counts recorded to the (optional) metrics sink. A traffic-specific sibling of the core
 *  `MetricsEmitter`, which records executions/gates rather than pipeline run counts. */
export interface TrafficRunCounts {
  ingested: number;
  redactions: number;
  clusters: number;
  specs: number;
  candidateCujs: number;
}

export interface TrafficMetrics {
  recordRun(counts: TrafficRunCounts): Promise<void> | void;
}

export interface RunTrafficInput {
  cfg: WardenConfig;
  source: TrafficSource; // opt-in capture (SDK | proxy)
  store: TrafficStore; // scrubbed sessions only
  scrubber: PiiScrubber; // mandatory, runs before store.put
  clusterer: JourneyClusterer;
  synthesizer: TestSynthesizer; // reused from @warden/recorder (AiTestSynthesizer)
  cujProposer: CujProposer;
  provider: LLMProvider;
  gh: GitHubAccess; // reused from @warden/coverage-sync (draft PR)
  metrics?: TrafficMetrics; // optional metrics sink
  target: { repo: string; branch: string }; // where the draft PR opens
  /** Upper bound on sessions pulled from the source per run. Defaults to 1000. */
  maxIngest?: number;
}

export interface TrafficRunSummary {
  status: 'disabled' | 'no-consent-traffic' | 'below-threshold' | 'proposed';
  ingested: number;
  redactions: number;
  clusters: JourneyCluster[];
  specs: GeneratedTest[];
  candidateCujs: CandidateCUJ[];
  draftPr?: { url: string; number: number };
}

const PR_TITLE = 'Warden: proposed E2E specs from production traffic';

function countToken(text: string | undefined, token: string): number {
  if (!text || token.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }
  return count;
}

/** Counts redaction tokens across a scrubbed session — the run's reported `redactions`. */
function countRedactions(session: RecordedSession, token: string): number {
  let n = countToken(session.url, token);
  for (const step of session.steps) {
    n += countToken(step.selector, token) + countToken(step.value, token);
  }
  return n;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/** The extra tags applied to every traffic-derived spec: `@traffic` plus a per-route tag. */
function extraTagsFor(cluster: JourneyCluster): string[] {
  const tags = ['@traffic'];
  if (cluster.routeTemplate) tags.push(`@route:${cluster.routeTemplate}`);
  return tags;
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/** Re-homes a synthesized spec under `outDir`, deduping filenames across all clusters. */
function repath(originalPath: string, outDir: string, used: Set<string>): string {
  const dir = outDir.replace(/\/+$/, '');
  const name = basename(originalPath);
  const ext = name.endsWith('.spec.ts') ? '.spec.ts' : '';
  const base = ext ? name.slice(0, -ext.length) : name;
  let candidate = `${dir}/${name}`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${dir}/${base}-${n}${ext}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

/** Inserts any missing tags into a rendered Playwright `{ tag: [...] }` list, if present. */
function ensureContentTags(content: string, tags: string[]): string {
  const marker = 'tag: [';
  const start = content.indexOf(marker);
  if (start === -1) return content;
  const listStart = start + marker.length;
  const end = content.indexOf(']', listStart);
  if (end === -1) return content;
  const existing = content.slice(listStart, end);
  const present = new Set(
    (existing.match(/'[^']*'|"[^"]*"/g) ?? []).map((quoted) => quoted.slice(1, -1)),
  );
  const toAdd = tags.filter((tag) => !present.has(tag));
  if (toAdd.length === 0) return content;
  const sep = existing.trim().length > 0 ? ', ' : '';
  const insertion = toAdd.map((tag) => `'${tag}'`).join(', ');
  return `${content.slice(0, end)}${sep}${insertion}${content.slice(end)}`;
}

/** Normalizes a synthesized spec: re-homed under `outDir`, tagged `@traffic` + route, dedup path. */
function normalizeSpec(
  test: GeneratedTest,
  cluster: JourneyCluster,
  outDir: string,
  used: Set<string>,
): GeneratedTest {
  const tags = uniq([...test.tags, ...extraTagsFor(cluster)]);
  return {
    path: repath(test.path, outDir, used),
    content: ensureContentTags(test.content, extraTagsFor(cluster)),
    tags,
  };
}

/** Renders the draft-PR body: a summary of the candidate CUJs and the run counts. */
function renderBody(input: {
  ingested: number;
  redactions: number;
  clusters: JourneyCluster[];
  eligible: JourneyCluster[];
  candidateCujs: CandidateCUJ[];
  specs: GeneratedTest[];
}): string {
  const lines: string[] = [
    '## Proposed from production traffic',
    '',
    'These specs were synthesized from **scrubbed, consenting** production sessions. Nothing here',
    'auto-merges — review the specs and the candidate journeys below before merging.',
    '',
    `- Ingested sessions: **${input.ingested}**`,
    `- PII redactions applied: **${input.redactions}**`,
    `- Candidate journeys (clusters): **${input.clusters.length}**`,
    `- Synthesized specs: **${input.specs.length}**`,
    '',
    '### Candidate Critical User Journeys',
    '',
  ];
  if (input.candidateCujs.length === 0) {
    lines.push('_None proposed._');
  } else {
    lines.push('| Journey | Route | Frequency | Specs |', '| --- | --- | --- | --- |');
    for (const cuj of input.candidateCujs) {
      lines.push(
        `| ${cuj.name} | \`${cuj.routeTemplate ?? '—'}\` | ${cuj.frequency} | ${cuj.testPaths
          .map((p) => `\`${p}\``)
          .join('<br>')} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

export async function runTraffic(input: RunTrafficInput): Promise<TrafficRunSummary> {
  const t = input.cfg.traffic;
  const token = t.pii.redactionToken;

  const emit = async (counts: TrafficRunCounts): Promise<void> => {
    if (input.metrics) await input.metrics.recordRun(counts);
  };

  if (!t.enabled) {
    return {
      status: 'disabled',
      ingested: 0,
      redactions: 0,
      clusters: [],
      specs: [],
      candidateCujs: [],
    };
  }

  // 1–3. Consent-aware collect, then scrub BEFORE store — only scrubbed sessions are persisted.
  const raw = await input.source.collect({ max: input.maxIngest ?? 1000 });
  let redactions = 0;
  for (const rawSession of raw) {
    const scrubbed = input.scrubber.scrub(rawSession);
    redactions += countRedactions(scrubbed, token);
    await input.store.put(scrubbed);
  }
  const ingested = raw.length;

  // 4. Retention sweep every run, enforcing the documented TTL.
  await input.store.prune(t.retention.scrubbedTtlDays);

  if (ingested === 0) {
    await emit({ ingested, redactions, clusters: 0, specs: 0, candidateCujs: 0 });
    return {
      status: 'no-consent-traffic',
      ingested,
      redactions,
      clusters: [],
      specs: [],
      candidateCujs: [],
    };
  }

  // 5. Cluster all scrubbed sessions (deterministic; ranked; sub-minSessions dropped).
  const stored = await input.store.list();
  const clusters = input.clusterer.cluster(stored);

  // 6. Select the top clusters above the synthesis frequency threshold.
  const eligible = clusters
    .filter((cluster) => cluster.frequency >= t.synthesis.minClusterFrequency)
    .slice(0, t.clustering.topClusters);

  if (eligible.length === 0) {
    await emit({ ingested, redactions, clusters: clusters.length, specs: 0, candidateCujs: 0 });
    return {
      status: 'below-threshold',
      ingested,
      redactions,
      clusters,
      specs: [],
      candidateCujs: [],
    };
  }

  // 7. Synthesize a spec per cluster (reused synthesizer), then propose a CUJ per cluster.
  const specs: GeneratedTest[] = [];
  const candidateCujs: CandidateCUJ[] = [];
  const usedPaths = new Set<string>();
  for (const cluster of eligible) {
    const generated = await input.synthesizer.synthesize(cluster.representative, input.provider);
    const tagged = generated.map((test) =>
      normalizeSpec(test, cluster, t.synthesis.outDir, usedPaths),
    );
    specs.push(...tagged);
    if (t.synthesis.proposeCujs) {
      candidateCujs.push(await input.cujProposer.propose(cluster, tagged, input.provider));
    }
  }

  // 8. Publish an idempotent DRAFT PR with the specs + a CUJ summary. Never auto-merged.
  const files = specs.map((spec) => ({ path: spec.path, content: spec.content }));
  const body = renderBody({ ingested, redactions, clusters, eligible, candidateCujs, specs });
  const draftPr = await input.gh.openOrUpdateDraftPr(
    input.target.repo,
    input.target.branch,
    files,
    PR_TITLE,
    body,
  );

  await emit({
    ingested,
    redactions,
    clusters: clusters.length,
    specs: specs.length,
    candidateCujs: candidateCujs.length,
  });

  return {
    status: 'proposed',
    ingested,
    redactions,
    clusters,
    specs,
    candidateCujs,
    draftPr: { url: draftPr.url, number: draftPr.number },
  };
}
