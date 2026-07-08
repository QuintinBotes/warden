import { WardenError, type DataProvider, type FixtureDef, type FixtureRecord } from '@warden/core';
import { namespaceRecords, renderTemplate } from '../template';

/**
 * `ApiDataProvider` — a {@link DataProvider} that calls a seed endpoint and a teardown endpoint via
 * an injected {@link HttpClient}, templating the run namespace into the request path/body. The
 * `seed`/`teardown` strings are JSON request specs (`{ method, path, body, headers }`) with `{{ns}}`
 * substituted before parsing. No real socket is opened here — the client is injected.
 */

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  body?: unknown;
}

/** The one capability the API provider needs from an HTTP client. */
export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** Non-secret API wiring. The auth header *value* is resolved from an env var by the caller. */
export interface ApiProviderOptions {
  /** Prepended to each spec's `path`. */
  baseUrl?: string;
  /** Full `Authorization` header value, e.g. `'Bearer …'`, resolved from an env var by the caller. */
  authHeader?: string;
}

interface ApiCallSpec {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ApiDataProvider implements DataProvider {
  readonly backend = 'api' as const;

  constructor(
    private readonly http: HttpClient,
    private readonly options: ApiProviderOptions = {},
  ) {}

  supports(def: FixtureDef): boolean {
    return def.backend === 'api';
  }

  async seed(def: FixtureDef, namespace: string): Promise<FixtureRecord[]> {
    await this.call(def.seed, namespace, def.id);
    return namespaceRecords(def.provides, namespace);
  }

  async teardown(def: FixtureDef, namespace: string): Promise<void> {
    await this.call(def.teardown, namespace, def.id);
  }

  private async call(template: string, namespace: string, id: string): Promise<HttpResponse> {
    const rendered = renderTemplate(template, namespace);
    let spec: ApiCallSpec;
    try {
      spec = JSON.parse(rendered) as ApiCallSpec;
    } catch (err) {
      throw new WardenError(
        `fixture "${id}" api template is not valid JSON: ${(err as Error).message}`,
        'E_FIXTURE_INVALID',
      );
    }
    if (typeof spec.path !== 'string') {
      throw new WardenError(
        `fixture "${id}" api template is missing a string "path"`,
        'E_FIXTURE_INVALID',
      );
    }
    const method = spec.method ?? 'POST';
    const url = `${this.options.baseUrl ?? ''}${spec.path}`;
    const headers: Record<string, string> = { ...(spec.headers ?? {}) };
    if (this.options.authHeader) headers.Authorization = this.options.authHeader;

    const res = await this.http.request({
      method,
      url,
      headers,
      ...(spec.body !== undefined && { body: spec.body }),
    });
    if (res.status >= 400) {
      throw new WardenError(
        `fixture "${id}" api call ${method} ${url} failed with status ${res.status}`,
        'E_FIXTURE_API',
      );
    }
    return res;
  }
}
