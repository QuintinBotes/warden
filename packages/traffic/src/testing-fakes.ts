import type {
  DraftPrResult,
  GeneratedTest,
  GitHubAccess,
  LLMProvider,
  PrRef,
  RawTrafficSession,
  RecordedSession,
  RecordedStep,
  TestSynthesizer,
  TrafficSource,
  TrafficStore,
} from '@warden/core';
import { stripTrailingSlashes } from '@warden/core';
import type { CapturedSessionInput } from './traffic-source.js';
import type { TrafficMetrics, TrafficRunCounts } from './run.js';

/**
 * Owned, in-memory test doubles + PII fixtures for `@warden/traffic`. Everything here is hermetic:
 * no real traffic, browser, network, or LLM. Never bundled into `dist` (excluded like the other
 * packages' `testing-fakes`).
 */

// ── PII fixtures (real-looking, so the scrub is genuinely exercised) ─────────────────────────
export const PII = {
  email: 'jane.doe@example.com',
  /** A Luhn-valid Visa test PAN. */
  pan: '4111111111111111',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.s5H7Qk9-fakeSignature_abc',
  ssn: '123-45-6789',
  uuid: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  bearer: 'Bearer sk-live-0123456789abcdefABCDEF',
} as const;

/** All raw PII strings — a test can assert none of them survive anywhere downstream. */
export const ALL_PII: string[] = [PII.email, PII.pan, PII.jwt, PII.ssn, PII.uuid, PII.bearer];

let anonCounter = 0;

/** Builds a `RawTrafficSession`, defaulting a fresh `anonId` and granted consent. */
export function rawSession(overrides: Partial<RawTrafficSession> = {}): RawTrafficSession {
  anonCounter += 1;
  return {
    url: 'https://shop.test/checkout/1001',
    startedAt: new Date('2026-07-08T10:00:00.000Z'),
    steps: [
      { action: 'goto', value: 'https://shop.test/checkout/1001' },
      { action: 'click', selector: 'Add to cart' },
    ],
    anonId: `anon-${anonCounter}`,
    consent: { granted: true, source: 'cookie' },
    routeTemplate: '/checkout/:id',
    ...overrides,
  };
}

/** A raw session with PII planted in a value, a URL, and a selector name — for scrub tests. */
export function piiLadenRawSession(): RawTrafficSession {
  return rawSession({
    url: `https://shop.test/u/${PII.uuid}?email=${PII.email}`,
    steps: [
      { action: 'fill', selector: 'Email', value: PII.email },
      { action: 'fill', selector: 'Card number', value: PII.pan },
      { action: 'fill', selector: 'SSN', value: `ssn ${PII.ssn}` },
      { action: 'auth', selector: 'Token', value: PII.bearer },
      { action: 'note', selector: PII.email, value: PII.jwt },
      { action: 'click', selector: 'Search', value: 'shoes' },
    ],
  });
}

// ── Fake traffic source ───────────────────────────────────────────────────────────────────────
/** An entry the fake source may or may not admit, mirroring what an SDK/proxy would buffer. */
export interface FakeSourceEntry extends CapturedSessionInput {
  consent?: { granted: boolean; source?: 'cookie' | 'config' | 'header' };
  doNotTrack?: boolean;
}

/**
 * A `TrafficSource` fake with a built-in consent gate: it only emits entries whose consent is
 * granted and which are not Do-Not-Track, bounded by `max`. Non-consenting entries are never
 * emitted — so the pipeline never even sees them.
 */
export function fakeTrafficSource(entries: FakeSourceEntry[]): TrafficSource {
  return {
    async collect({ max }): Promise<RawTrafficSession[]> {
      const out: RawTrafficSession[] = [];
      for (const entry of entries) {
        if (out.length >= max) break;
        if (!entry.consent?.granted) continue;
        if (entry.doNotTrack) continue;
        out.push({
          url: entry.url,
          startedAt: entry.startedAt instanceof Date ? entry.startedAt : new Date(entry.startedAt),
          steps: entry.steps,
          anonId: entry.anonId,
          consent: { granted: true, source: entry.consent.source ?? 'cookie' },
          routeTemplate: entry.routeTemplate,
        });
      }
      return out;
    },
  };
}

// ── In-memory traffic store ─────────────────────────────────────────────────────────────────
export interface InMemoryTrafficStore extends TrafficStore {
  /** Every session handed to `put`, for assertions (e.g. that no raw session was stored). */
  readonly puts: RecordedSession[];
}

/**
 * An in-memory {@link TrafficStore} with an injectable clock so `prune(ttlDays)` is deterministic.
 * `put` stamps each session with `now()`; `prune` drops sessions stored before `now() - ttlDays`.
 */
export function inMemoryTrafficStore(opts: { now?: () => Date } = {}): InMemoryTrafficStore {
  const now = opts.now ?? (() => new Date());
  const records: { storedAt: number; session: RecordedSession }[] = [];
  const puts: RecordedSession[] = [];
  return {
    puts,
    async put(session: RecordedSession): Promise<void> {
      puts.push(session);
      records.push({ storedAt: now().getTime(), session });
    },
    async list(): Promise<RecordedSession[]> {
      return records.map((r) => r.session);
    },
    async prune(ttlDays: number): Promise<number> {
      const cutoff = now().getTime() - ttlDays * 24 * 60 * 60 * 1000;
      let pruned = 0;
      for (let i = records.length - 1; i >= 0; i -= 1) {
        if (records[i]!.storedAt < cutoff) {
          records.splice(i, 1);
          pruned += 1;
        }
      }
      return pruned;
    },
  };
}

// ── Fake test synthesizer (stands in for the reused AiTestSynthesizer) ──────────────────────
export interface FakeSynthesizerOptions {
  testDir?: string;
  baseTags?: string[];
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'flow';
}

/**
 * A deterministic {@link TestSynthesizer} that renders one tagged, role-based Playwright spec per
 * session — the same output shape as the real `AiTestSynthesizer`, but with no LLM. It still calls
 * the provider once (so provider wiring is exercised), then ignores the response.
 */
export function fakeTestSynthesizer(opts: FakeSynthesizerOptions = {}): TestSynthesizer {
  const testDir = stripTrailingSlashes(opts.testDir ?? 'tests/generated');
  const baseTags = opts.baseTags ?? ['@e2e'];
  return {
    async synthesize(session: RecordedSession, provider: LLMProvider): Promise<GeneratedTest[]> {
      await provider.generateText('synthesize');
      const name = `Flow ${slugify(new URL(session.url, 'https://x.test').pathname)}`;
      const tagList = baseTags.map((tag) => `'${tag}'`).join(', ');
      const body = session.steps
        .map((step: RecordedStep) => {
          if (step.action === 'goto') return `  await page.goto('${session.url}');`;
          if (step.action === 'click')
            return `  await page.getByRole('button', { name: ${JSON.stringify(
              step.selector ?? '',
            )} }).click();`;
          return `  await page.getByLabel(${JSON.stringify(step.selector ?? '')}).fill(${JSON.stringify(
            step.value ?? '',
          )});`;
        })
        .join('\n');
      const content = [
        `import { test, expect } from '@playwright/test';`,
        '',
        `test(${JSON.stringify(name)}, { tag: [${tagList}] }, async ({ page }) => {`,
        body,
        '});',
        '',
      ].join('\n');
      return [{ path: `${testDir}/${slugify(name)}.spec.ts`, content, tags: [...baseTags] }];
    },
  };
}

// ── Recording GitHub access (draft PR publisher) ────────────────────────────────────────────
export interface DraftPrCall {
  repo: string;
  branch: string;
  files: { path: string; content: string | null }[];
  title: string;
  body: string;
}

export interface RecordingGitHubAccess extends GitHubAccess {
  readonly draftPrCalls: DraftPrCall[];
}

/** A recording {@link GitHubAccess}: captures draft-PR calls and returns deterministic results. */
export function recordingGitHub(): RecordingGitHubAccess {
  const draftPrCalls: DraftPrCall[] = [];
  return {
    draftPrCalls,
    async openOrUpdateDraftPr(repo, branch, files, title, body): Promise<DraftPrResult> {
      draftPrCalls.push({ repo, branch, files, title, body });
      const number = 100 + draftPrCalls.length;
      return { url: `https://github.com/${repo}/pull/${number}`, number };
    },
    async addPrSuggestions(_pr: PrRef, _files, _summary): Promise<void> {
      // unused by the traffic pipeline
    },
    async postCheckRun(_pr: PrRef, _conclusion, _title, _summary): Promise<void> {
      // unused by the traffic pipeline
    },
  };
}

// ── Recording metrics sink ──────────────────────────────────────────────────────────────────
export interface RecordingTrafficMetrics extends TrafficMetrics {
  readonly runs: TrafficRunCounts[];
}

export function recordingTrafficMetrics(): RecordingTrafficMetrics {
  const runs: TrafficRunCounts[] = [];
  return {
    runs,
    recordRun(counts: TrafficRunCounts): void {
      runs.push(counts);
    },
  };
}
