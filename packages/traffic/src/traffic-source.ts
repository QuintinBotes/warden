import type { RawTrafficSession, RecordedStep, TrafficSource, WardenConfig } from '@warden/core';

/**
 * The two shipped {@link TrafficSource} defaults. Both own **no** browser or network dependency of
 * their own — the actual transport (a `fetch` to the collector, or a HAR/proxy reader) is injected,
 * so each source is hermetically unit-testable. Both apply the same consent gate defense-in-depth
 * (require an explicit consent signal, honor Do-Not-Track / GPC) plus deterministic sampling before
 * emitting a `RawTrafficSession`. Non-consenting or DNT traffic is never emitted.
 */

/** A capture as it arrives from the SDK / proxy, before the consent gate + normalization. */
export interface CapturedSessionInput {
  anonId: string;
  url: string;
  startedAt: Date | string;
  steps: RecordedStep[];
  routeTemplate?: string;
  consent?: { granted: boolean; source?: 'cookie' | 'config' | 'header' };
  /** DNT / GPC signal for this session; suppresses capture even when consent is present. */
  doNotTrack?: boolean;
}

/** The consent gate + normalization shared by every source. Returns `null` to drop a capture. */
export function admitCapture(
  input: CapturedSessionInput,
  cfg: WardenConfig,
  random: () => number,
  defaultConsentSource: 'cookie' | 'header' | 'config',
): RawTrafficSession | null {
  const t = cfg.traffic;
  if (t.consent.required && !input.consent?.granted) return null;
  if (t.consent.honorDoNotTrack && input.doNotTrack) return null;
  // Deterministic sampling: sampleRate 1 always admits, 0 never does.
  if (random() >= t.sampleRate) return null;

  return {
    url: input.url,
    startedAt: input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt),
    steps: input.steps,
    anonId: input.anonId,
    consent: { granted: true, source: input.consent?.source ?? defaultConsentSource },
    routeTemplate: input.routeTemplate,
  };
}

function admitAll(
  inputs: CapturedSessionInput[],
  cfg: WardenConfig,
  random: () => number,
  source: 'cookie' | 'header' | 'config',
  max: number,
): RawTrafficSession[] {
  const out: RawTrafficSession[] = [];
  for (const input of inputs) {
    if (out.length >= max) break;
    const admitted = admitCapture(input, cfg, random, source);
    if (admitted) out.push(admitted);
  }
  return out;
}

export interface BrowserSdkSourceOptions {
  cfg: WardenConfig;
  /** Pulls buffered captures from the self-hostable collector. Injected (a `fetch` wrapper). */
  pull: (opts: { max: number }) => Promise<CapturedSessionInput[]>;
  /** Sampling RNG; injected for deterministic tests. Defaults to `Math.random`. */
  random?: () => number;
}

/** The opt-in browser-SDK source: consenting sessions POST to a collector, which this pulls from. */
export function browserSdkSource(opts: BrowserSdkSourceOptions): TrafficSource {
  const random = opts.random ?? Math.random;
  return {
    async collect({ max }): Promise<RawTrafficSession[]> {
      const captures = await opts.pull({ max });
      return admitAll(captures, opts.cfg, random, 'cookie', max);
    },
  };
}

export interface ReverseProxySourceOptions {
  cfg: WardenConfig;
  /** Reads flagged, consenting exchanges (e.g. from a HAR tap) reconstructed into sessions. */
  readSessions: (opts: { max: number }) => Promise<CapturedSessionInput[]>;
  random?: () => number;
}

/** The reverse-proxy source: a HAR/proxy tap reconstructs UI journeys from HTTP exchanges. */
export function reverseProxySource(opts: ReverseProxySourceOptions): TrafficSource {
  const random = opts.random ?? Math.random;
  return {
    async collect({ max }): Promise<RawTrafficSession[]> {
      const sessions = await opts.readSessions({ max });
      return admitAll(sessions, opts.cfg, random, 'header', max);
    },
  };
}
