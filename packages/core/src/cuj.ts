import { z } from 'zod';

/**
 * Critical User Journey (CUJ) — a named, ordered, business-critical path through the product
 * (sign-in → add-to-cart → checkout → confirmation), owned by a team and linked to the
 * requirements and tests that exercise it. Schema-first exactly like `schema.ts`: the Zod
 * schema is the single source of truth and the TS type is inferred, so runtime validation and
 * compile-time types cannot drift.
 *
 * The domain entity plus its rollup/gate value types live here; the pure engine that consumes
 * them (health rollup, scoped gate, board projection) is `@warden/cuj`. Everything here is
 * additive to `@warden/core`.
 */

/** Business criticality — drives how hard the gate reacts to a regression. */
export const CujTier = z.enum(['tier1', 'tier2', 'tier3']);
export type CujTier = z.infer<typeof CujTier>;

/** Rolled-up health of a journey or one of its steps. */
export const CujHealthStatus = z.enum(['HEALTHY', 'DEGRADED', 'BROKEN', 'NOT_TESTED']);
export type CujHealthStatus = z.infer<typeof CujHealthStatus>;

/** SLO-style thresholds, all optional; unset means "tests alone decide health". */
export const CujThresholdsSchema = z
  .object({
    minPassRatePercent: z.number().default(100),
    maxP95LatencyMs: z.number().optional(),
    requireA11y: z.boolean().default(false),
    maxVisualDiffRatio: z.number().optional(),
  })
  .default({});
export type CujThresholds = z.infer<typeof CujThresholdsSchema>;

/** One ordered step in a journey, linked to the tests/requirements that exercise it. */
export const CujStepSchema = z.object({
  order: z.number().int().nonnegative(),
  name: z.string(), // e.g. "Add item to cart"
  module: z.string().optional(), // a test tag, e.g. '@apps/checkout' — ties into the change surface
  testIds: z.array(z.string()).default([]), // TestCase ids covering this step
  requirementIds: z.array(z.string()).default([]),
});
export type CujStep = z.infer<typeof CujStepSchema>;

export const CujSchema = z.object({
  id: z.string(), // e.g. "CUJ-checkout"
  name: z.string(), // e.g. "Guest checkout"
  description: z.string().optional(),
  owningTeam: z.string(), // a free-form team slug for routing/notification, not an identity system
  tier: CujTier.default('tier1'),
  steps: z.array(CujStepSchema).default([]),
  requirementIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]), // module/test tags this journey spans
  thresholds: CujThresholdsSchema,
});
export type Cuj = z.infer<typeof CujSchema>;

/**
 * An already-evaluated non-functional signal, emitted by whatever tier produced it
 * (a11y/perf/visual). `passed` is the tier's own verdict; `blocking` lets a signal escalate
 * to BROKEN instead of DEGRADED.
 */
export interface CujSignal {
  kind: 'a11y' | 'perf' | 'visual';
  step?: string; // step name it applies to, or undefined for the whole journey
  value: number; // p95 ms, violation count, diff ratio, ...
  passed: boolean;
  blocking?: boolean;
}

export interface CujStepHealth {
  order: number;
  name: string;
  status: CujHealthStatus;
}

/** The rolled-up health of one CUJ, ready for the gate, the reporter, and the dashboard board. */
export interface CujHealthReport {
  cujId: string;
  name: string;
  owningTeam: string;
  tier: CujTier;
  status: CujHealthStatus;
  passRatePercent: number;
  steps: CujStepHealth[];
  failingSignals: CujSignal[];
  computedAt: string; // ISO timestamp
}

/** A CUJ the current change surface intersects, with why it matched. */
export interface TouchedCuj {
  cuj: Cuj;
  matchedTags: string[]; // the change-surface tags/modules that intersected this CUJ
  reason: string;
}

/**
 * The dashboard's CUJ-board read port. A small sibling of `DashboardDataApi` so the board is
 * additive by construction — implementing it never touches the existing dashboard interface.
 */
export interface CujBoardApi {
  cujBoard(): Promise<CujHealthReport[]>;
}
