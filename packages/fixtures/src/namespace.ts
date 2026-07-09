import { contentId, slugify } from '@warden/core';

/**
 * `RunNamespace` — derives a short, deterministic, collision-safe namespace used to prefix/suffix
 * every seeded identifier so parallel runs are isolated. The same inputs always yield the same
 * namespace (reproducible caching/resume), while any change in trigger, tier, or shard yields a
 * different one (two shards of the same PR can never collide).
 */

export interface NamespaceInput {
  /** The run's trigger reference, e.g. `'pr-482'`, `'482'`, a branch, or a sha. */
  triggerRef: string;
  /** The selected tier, e.g. `'selective'`. */
  tier?: string;
  /** The shard index/id when `namespaceStrategy: 'per-shard'`. */
  shardId?: string | number;
}

function slug(part: string, max: number): string {
  return slugify(part.toLowerCase()).slice(0, max);
}

/**
 * Builds a namespace like `pr-482-selective-s2-a1b2c3`: readable slug parts (trigger, tier, shard)
 * plus a deterministic 6-hex suffix over the full identity so collisions are impossible even after
 * the readable parts are truncated.
 */
export function deriveNamespace(input: NamespaceInput): string {
  const parts: string[] = [];

  const ref = slug(String(input.triggerRef), 16);
  if (ref) parts.push(ref);

  if (input.tier) {
    const tier = slug(input.tier, 12);
    if (tier) parts.push(tier);
  }

  const shard = input.shardId;
  if (shard !== undefined && shard !== null && String(shard) !== '') {
    const s = slug(String(shard), 6);
    if (s) parts.push(`s${s}`);
  }

  const identity = [input.triggerRef, input.tier ?? '', input.shardId ?? ''].join('|');
  const suffix = (contentId('ns', identity).split('-')[1] ?? '00000000').slice(0, 6);
  parts.push(suffix);

  return parts.join('-');
}
