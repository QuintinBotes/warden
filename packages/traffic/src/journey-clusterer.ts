import type { JourneyCluster, JourneyClusterer, RecordedSession, RecordedStep } from '@warden/core';

/**
 * `createJourneyClusterer` — the deterministic, LLM-free grouping step. Scrubbed sessions that
 * share a canonical signature (route template + the sequence of action/selector pairs) are one
 * candidate journey; each cluster is ranked by `frequency × businessWeightByRoute`. Clusters
 * below `minSessions` are dropped. The representative is the **median-length** member, chosen
 * deterministically so the same input always yields the same spec.
 */
export interface JourneyClustererOptions {
  /** Ignore clusters with fewer sessions than this. */
  minSessions?: number;
  /** Multiplier per route template, e.g. `{ '/checkout/:id': 5 }`. Missing routes weight 1. */
  businessWeightByRoute?: Record<string, number>;
  /** The scrubber's redaction token; a URL segment equal to it is treated as an `:id` param. */
  redactionToken?: string;
}

const DEFAULT_TOKEN = '[REDACTED]';

/** Extracts the pathname from a URL, tolerating relative paths and malformed input. */
function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    const withoutQuery = url.split(/[?#]/)[0] ?? url;
    const stripped = withoutQuery.replace(/^[a-z]+:\/\/[^/]+/i, '');
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }
}

/** True if a path segment looks like an id (numeric, hex, uuid, or the redaction token). */
function isIdSegment(segment: string, token: string): boolean {
  if (segment === token) return true;
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  if (/^[0-9a-f]{16,}$/i.test(segment)) return true;
  return false;
}

/** Canonicalizes a URL into a route template, e.g. `/checkout/abc123` → `/checkout/:id`. */
export function routeTemplateOf(url: string, token: string = DEFAULT_TOKEN): string {
  const path = pathnameOf(url);
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return '/';
  return `/${segments.map((s) => (isIdSegment(s, token) ? ':id' : s)).join('/')}`;
}

/** A stable, PII-free canonical form of a step: its action plus its (already-scrubbed) selector. */
function canonicalStep(step: RecordedStep): string {
  return `${step.action}:${step.selector ?? ''}`;
}

/**
 * The signature that defines a cluster: the route template plus the **canonical set** of distinct
 * interaction descriptors on the session (sorted, order- and repetition-independent). This tolerates
 * the real-world variation between two runs of the same journey — a different click order, an extra
 * repeated step — so they cluster together, while staying fully deterministic (no LLM). Because
 * members can then differ in length, the representative is chosen as the median-length session.
 * Signature-based grouping can over- or under-merge; smarter clustering is future work.
 */
function signatureOf(session: RecordedSession, token: string): string {
  const route = routeTemplateOf(session.url, token);
  const interactions = [...new Set(session.steps.map(canonicalStep))].sort();
  return `${route}|${interactions.join('>')}`;
}

interface Bucket {
  signature: string;
  routeTemplate: string;
  members: RecordedSession[];
}

/** Deterministic median-length representative: sort by (steps.length, url), pick the middle. */
function pickRepresentative(members: RecordedSession[]): RecordedSession {
  const sorted = [...members].sort(
    (a, b) => a.steps.length - b.steps.length || a.url.localeCompare(b.url),
  );
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function createJourneyClusterer(opts: JourneyClustererOptions = {}): JourneyClusterer {
  const minSessions = opts.minSessions ?? 0;
  const weights = opts.businessWeightByRoute ?? {};
  const token = opts.redactionToken ?? DEFAULT_TOKEN;

  return {
    cluster(sessions: RecordedSession[]): JourneyCluster[] {
      const buckets = new Map<string, Bucket>();
      for (const session of sessions) {
        const signature = signatureOf(session, token);
        const existing = buckets.get(signature);
        if (existing) {
          existing.members.push(session);
        } else {
          buckets.set(signature, {
            signature,
            routeTemplate: routeTemplateOf(session.url, token),
            members: [session],
          });
        }
      }

      const clusters: JourneyCluster[] = [];
      for (const bucket of buckets.values()) {
        const frequency = bucket.members.length;
        if (frequency < minSessions) continue;
        const weight = frequency * (weights[bucket.routeTemplate] ?? 1);
        clusters.push({
          signature: bucket.signature,
          routeTemplate: bucket.routeTemplate,
          frequency,
          weight,
          representative: pickRepresentative(bucket.members),
        });
      }

      // Rank by weight, then frequency, then signature — fully deterministic.
      clusters.sort(
        (a, b) =>
          b.weight - a.weight ||
          b.frequency - a.frequency ||
          a.signature.localeCompare(b.signature),
      );
      return clusters;
    },
  };
}
