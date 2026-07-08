import type {
  BrowserLaunchOptions,
  GridCapability,
  GridCapabilityRequest,
  GridConfig,
  GridPlatform,
  GridProvider,
  GridSessionInfo,
  LaneOutcome,
} from '@warden/core';
import { expandMatrix, type MatrixBrowser } from '@warden/runner';

/**
 * The zero-infra default provider. `capabilities()` maps the configured matrix to local Playwright
 * project lanes via the runner's `expandMatrix` (so the lane set is exactly the Playwright projects
 * a plain `local` run would iterate); `openSession()` returns a local endpoint and `closeSession()`
 * is a no-op. Makes **no** network calls — the whole path stays hermetic for teams without a grid
 * account. Local lanes are always `real: false` (headless Playwright, not a real device).
 */
export class LocalGridProvider implements GridProvider {
  readonly name = 'local' as const;

  constructor(private readonly config: GridConfig) {}

  async capabilities(request: GridCapabilityRequest): Promise<GridCapability[]> {
    const devices = request.devices ?? [];
    // expandMatrix validates the browsers (throws BrowserError on unknown/empty) and pins the
    // canonical ordering; local only supports the three Playwright browsers.
    expandMatrix({ browsers: request.browsers as MatrixBrowser[], devices });

    const caps: GridCapability[] = [];
    const seen = new Set<string>();
    for (const browser of request.browsers) {
      if (devices.length === 0) {
        this.push(caps, seen, browser, undefined);
      } else {
        for (const device of devices) this.push(caps, seen, browser, device);
      }
    }
    return caps;
  }

  private push(
    caps: GridCapability[],
    seen: Set<string>,
    browser: GridCapability['browser'],
    device: string | undefined,
  ): void {
    const project = device ? `${browser}-${device}` : browser;
    if (seen.has(project)) return;
    seen.add(project);
    const cap: GridCapability = {
      id: `local:${project}`,
      browser,
      platform: LOCAL_PLATFORM,
      real: false,
    };
    if (device !== undefined) cap.device = device;
    caps.push(cap);
  }

  async openSession(
    capability: GridCapability,
    _opts: BrowserLaunchOptions,
  ): Promise<GridSessionInfo> {
    // No network: the lane runs against the local Playwright project named by the lane id.
    return {
      capability,
      endpoint: `local://${capability.id}`,
      sessionId: `local-${capability.id}`,
    };
  }

  async closeSession(_info: GridSessionInfo, _outcome: LaneOutcome): Promise<void> {
    // Nothing to release — the local run owns its own browser lifecycle.
  }
}

const LOCAL_PLATFORM: GridPlatform = 'linux';
