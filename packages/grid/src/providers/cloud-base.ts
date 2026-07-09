import type {
  BrowserLaunchOptions,
  GridBrowser,
  GridCapability,
  GridCapabilityRequest,
  GridConfig,
  GridPlatform,
  GridProvider,
  GridSessionInfo,
  LaneOutcome,
} from '@warden/core';
import { slugify } from '@warden/core';
import { GridCapacityError, type GridHttpClient } from '../http-client';

/**
 * Per-vendor endpoints + credential env var names. Each concrete cloud provider supplies one; the
 * shared {@link CloudGridProvider} drives the same three-call seam
 * (`capabilities`/`openSession`/`closeSession`) over an injected {@link GridHttpClient}.
 */
export interface CloudProviderSpec {
  name: 'browserstack' | 'saucelabs' | 'lambdatest';
  usernameEnv: string;
  accessKeyEnv: string;
  /** GET — the live browser/device catalog. */
  catalogUrl: string;
  /** POST — provision one session. */
  sessionUrl: string;
  /** WebDriver/Playwright hub base used to build the driving endpoint. */
  hubUrl: string;
}

/** One entry in a provider's live catalog response. */
export interface CatalogEntry {
  browser: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  device?: string;
  real?: boolean;
}

/** The provider's session-provisioning response. */
export interface OpenSessionResponse {
  sessionId?: string;
  /** Present when the provider is at capacity; triggers bounded-backoff retry then a skipped lane. */
  status?: string;
  endpoint?: string;
  replayUrl?: string;
}

/** Injected collaborators for a cloud provider — everything network/time is a seam. */
export interface CloudProviderDeps {
  http: GridHttpClient;
  /** Injected environment (credentials only; never from config). Defaults to `process.env`. */
  env: Record<string, string | undefined>;
  config: GridConfig;
  /** Bounded-backoff sleep (injected so tests never wait on a real timer). */
  sleep?: (ms: number) => Promise<void>;
  /** Max `openSession` attempts before a capacity error. */
  openRetries?: number;
  /** Base backoff between capacity retries. */
  backoffMs?: number;
}

const STATUS_QUEUE_FULL = new Set(['queue_full', 'queued', 'capacity', 'busy']);

function slug(value: string): string {
  return slugify(value.toLowerCase());
}

function mapPlatform(os: string | undefined, device: string | undefined): GridPlatform {
  const o = (os ?? '').toLowerCase();
  if (o.includes('ios') || o.includes('iphone') || o.includes('ipad')) return 'ios';
  if (o.includes('android')) return 'android';
  if (o.includes('win')) return 'windows';
  if (o.includes('mac') || o.includes('os x')) return 'macos';
  if (o) return 'linux';
  // No OS on the catalog entry: infer from the device model if any.
  const d = (device ?? '').toLowerCase();
  if (d.includes('iphone') || d.includes('ipad')) return 'ios';
  if (d.includes('pixel') || d.includes('galaxy') || d.includes('android')) return 'android';
  return 'linux';
}

/**
 * The shared cloud grid adapter. `capabilities()` GETs the live catalog and returns the servable
 * crossing of requested browsers × devices; `openSession()` POSTs a provisioning request (retrying
 * with bounded backoff on a capacity response, then raising {@link GridCapacityError} so the CI
 * wiring records a skipped lane); `closeSession()` POSTs the final outcome. Credentials come from
 * the injected env via HTTP Basic auth — never from config.
 */
export class CloudGridProvider implements GridProvider {
  readonly name: CloudProviderSpec['name'];
  private readonly http: GridHttpClient;
  private readonly env: Record<string, string | undefined>;
  private readonly config: GridConfig;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly openRetries: number;
  private readonly backoffMs: number;

  constructor(
    private readonly spec: CloudProviderSpec,
    deps: CloudProviderDeps,
  ) {
    this.name = spec.name;
    this.http = deps.http;
    this.env = deps.env;
    this.config = deps.config;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.openRetries = deps.openRetries ?? 3;
    this.backoffMs = deps.backoffMs ?? 500;
  }

  /** The credentials read from the injected env; absent values surface as empty strings. */
  private credentials(): { username: string; accessKey: string } {
    return {
      username: this.env[this.spec.usernameEnv] ?? '',
      accessKey: this.env[this.spec.accessKeyEnv] ?? '',
    };
  }

  private authHeaders(): Record<string, string> {
    const { username, accessKey } = this.credentials();
    const token = Buffer.from(`${username}:${accessKey}`).toString('base64');
    return { authorization: `Basic ${token}` };
  }

  async capabilities(request: GridCapabilityRequest): Promise<GridCapability[]> {
    const raw = await this.http.getJson<CatalogEntry[] | { capabilities?: CatalogEntry[] }>(
      this.spec.catalogUrl,
      this.authHeaders(),
    );
    const catalog: CatalogEntry[] = Array.isArray(raw) ? raw : (raw.capabilities ?? []);
    const devices = request.devices ?? [];

    const caps: GridCapability[] = [];
    for (const browser of request.browsers) {
      if (devices.length === 0) {
        const entry = catalog.find((e) => e.browser?.toLowerCase() === browser && !e.device);
        if (entry) caps.push(this.toCapability(browser, entry, undefined));
      } else {
        for (const device of devices) {
          const entry = catalog.find(
            (e) => e.browser?.toLowerCase() === browser && e.device === device,
          );
          if (entry) caps.push(this.toCapability(browser, entry, device));
        }
      }
    }
    return caps;
  }

  private toCapability(
    browser: GridBrowser,
    entry: CatalogEntry,
    device: string | undefined,
  ): GridCapability {
    const parts: string[] = [this.spec.name, browser];
    if (entry.browserVersion) parts[1] = `${browser}-${entry.browserVersion}`;
    const id = device ? `${parts.join(':')}:${slug(device)}` : parts.join(':');
    const cap: GridCapability = {
      id,
      browser,
      platform: mapPlatform(entry.os, device),
      real: entry.real ?? device !== undefined,
    };
    if (entry.browserVersion !== undefined) cap.browserVersion = entry.browserVersion;
    if (entry.osVersion !== undefined) cap.platformVersion = entry.osVersion;
    if (device !== undefined) cap.device = device;
    return cap;
  }

  async openSession(
    capability: GridCapability,
    opts: BrowserLaunchOptions,
  ): Promise<GridSessionInfo> {
    const body = pruneUndefined({
      browserName: capability.browser,
      browserVersion: capability.browserVersion,
      platformName: capability.platform,
      platformVersion: capability.platformVersion,
      device: capability.device,
      realMobile: capability.real,
      headless: opts.headless,
      project: this.config.project,
      build: this.config.project,
      region: this.config.region,
    });

    for (let attempt = 1; ; attempt++) {
      const res = await this.http.postJson<OpenSessionResponse>(
        this.spec.sessionUrl,
        body,
        this.authHeaders(),
      );
      const status = (res.status ?? '').toLowerCase();
      if (STATUS_QUEUE_FULL.has(status)) {
        if (attempt >= this.openRetries) {
          throw new GridCapacityError(
            `${this.spec.name} at capacity for lane ${capability.id} after ${attempt} attempts`,
          );
        }
        await this.sleep(this.backoffMs * attempt);
        continue;
      }

      const sessionId = res.sessionId ?? '';
      const rawEndpoint = res.endpoint ?? `${this.spec.hubUrl}/session/${sessionId}`;
      const endpoint = this.http.connect(rawEndpoint).endpoint;
      const info: GridSessionInfo = { capability, endpoint, sessionId };
      if (res.replayUrl !== undefined) info.replayUrl = res.replayUrl;
      return info;
    }
  }

  async closeSession(info: GridSessionInfo, outcome: LaneOutcome): Promise<void> {
    await this.http.postJson(
      `${this.spec.sessionUrl}/${info.sessionId}/status`,
      { status: outcome },
      this.authHeaders(),
    );
  }
}

function pruneUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
