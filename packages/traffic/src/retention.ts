import type { TrafficStore, WardenConfig } from '@warden/core';

/**
 * The retention sweeper — a thin, config-driven wrapper over `TrafficStore.prune`. It is invoked
 * on every run so the documented retention window (`traffic.retention.scrubbedTtlDays`) is
 * enforced continuously, not just by an out-of-band cron. Returns how many scrubbed sessions were
 * pruned so the run summary and metrics can report it.
 */
export interface RetentionSweeper {
  sweep(store: TrafficStore): Promise<number>;
}

export function createRetentionSweeper(cfg: WardenConfig): RetentionSweeper {
  const ttlDays = cfg.traffic.retention.scrubbedTtlDays;
  return {
    sweep(store: TrafficStore): Promise<number> {
      return store.prune(ttlDays);
    },
  };
}
