import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { App } from '@octokit/app';
import { createNodeMiddleware } from '@octokit/webhooks';
import {
  ConfigError,
  WardenConfigSchema,
  assertPromptsStayLocal,
  defineConfig,
  type DiffFile,
  type FileAccess,
  type LoadedConfig,
  type PrRef,
} from '@warden/core';
import { run, type PullRequestEvent } from './app.js';
import type { OctokitLike } from './octokit-file-access.js';

export interface WebhookServerOptions {
  /** GitHub App id. */
  appId: string | number;
  /** GitHub App private key (PEM). */
  privateKey: string;
  /** Webhook signing secret. */
  webhookSecret: string;
  /** Path the webhook endpoint is mounted at. Defaults to `/api/github/webhooks`. */
  webhookPath?: string;
  /** Source-repo config file read over the contents API. Defaults to `warden.config.json`. */
  configPath?: string;
}

/** Map a GitHub PR-files `status` to a Warden {@link DiffFile} status. */
function mapStatus(status: string): DiffFile['status'] {
  switch (status) {
    case 'added':
      return 'added';
    case 'removed':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

/** Production `fetchDiff`: page through `GET /repos/.../pulls/{n}/files`. */
async function fetchPrDiff(octokit: OctokitLike, pr: PrRef): Promise<DiffFile[]> {
  const files: DiffFile[] = [];
  for (let page = 1; ; page += 1) {
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
      per_page: 100,
      page,
    });
    const batch: Array<{
      filename: string;
      status: string;
      additions?: number;
      deletions?: number;
      patch?: string;
    }> = res.data ?? [];
    for (const file of batch) {
      files.push({
        path: file.filename,
        status: mapStatus(file.status),
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      });
    }
    if (batch.length < 100) break;
  }
  return files;
}

/**
 * Production `loadConfig`: read + validate `configPath` from the source repo.
 *
 * The three outcomes stay three outcomes. An absent config (a 404, which `readFile` reports as
 * `null`) yields the defaults with `configured: false`, because a repository that never
 * configured Warden must not be described as one that chose these settings. A config that is
 * present but unparseable or schema-invalid throws: substituting the defaults for it would run
 * the whole pipeline against settings the repository did not write, and say nothing.
 *
 * The file still comes from the repository under test, so it may not redirect model prompts off
 * this machine. One that tries is a present-but-invalid config and throws with the rest.
 */
export async function loadRepoConfig(
  configPath: string,
  fileAccess: FileAccess,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<LoadedConfig> {
  const raw = await fileAccess.readFile(configPath);
  if (!raw) {
    warn(
      `warden: no ${configPath} in this repository — coverage sync is running on Warden's ` +
        "built-in defaults, not this repository's settings.",
    );
    return { config: defineConfig(), sourcePath: null, configured: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `Invalid ${configPath}: not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const result = WardenConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Invalid ${configPath}: ${result.error.message}`);
  }
  assertPromptsStayLocal(result.data, configPath);
  return { config: result.data, sourcePath: configPath, configured: true };
}

/**
 * Build the webhook HTTP server that wires `pull_request` events to {@link run}
 * with production dependencies (an App-scoped octokit per installation).
 *
 * The server is returned unstarted — the caller decides when to `listen`, so
 * importing this module never binds a port.
 */
export function createWebhookServer(opts: WebhookServerOptions): Server {
  const app = new App({
    appId: opts.appId,
    privateKey: opts.privateKey,
    webhooks: { secret: opts.webhookSecret },
  });
  const configPath = opts.configPath ?? 'warden.config.json';
  const webhookPath = opts.webhookPath ?? '/api/github/webhooks';

  app.webhooks.on('pull_request', async ({ payload, octokit }) => {
    // The App transform hands us an installation-scoped octokit for this event.
    const scoped = octokit as unknown as OctokitLike;
    await run({
      event: payload as unknown as PullRequestEvent,
      octokitFor: () => scoped,
      loadConfig: async (_repo, fileAccess) =>
        (await loadRepoConfig(configPath, fileAccess)).config,
      fetchDiff: fetchPrDiff,
    });
  });

  // `@octokit/app` carries its own (older) `Webhooks` type whose context differs from the
  // top-level `@octokit/webhooks` v14 that `createNodeMiddleware` expects — a type-only variance
  // (the instance is the same at runtime), so cast to the middleware's exact parameter type.
  const middleware = createNodeMiddleware(
    app.webhooks as unknown as Parameters<typeof createNodeMiddleware>[0],
    { path: webhookPath },
  );

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    const handled = await middleware(req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
}
