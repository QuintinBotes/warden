import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '@warden/core';
import { ApiDataProvider, type HttpClient, type HttpRequest, type HttpResponse } from './api';

function fakeHttpClient(status = 201): HttpClient & { requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  return {
    requests,
    async request(req: HttpRequest): Promise<HttpResponse> {
      requests.push(req);
      return { status, body: { ok: true } };
    },
  };
}

const def: FixtureDef = {
  id: 'api-customer',
  appliesTo: ['@apps/checkout'],
  backend: 'api',
  seed: '{"method":"POST","path":"/customers","body":{"email":"primary+{{ns}}@test.warden"}}',
  teardown: '{"method":"DELETE","path":"/customers/{{ns}}"}',
  provides: [
    { entity: 'customer', key: 'primary', fields: { email: 'primary+{{ns}}@test.warden' } },
  ],
};

describe('ApiDataProvider', () => {
  it('supports only api fixtures', () => {
    const provider = new ApiDataProvider(fakeHttpClient());
    expect(provider.supports(def)).toBe(true);
    expect(provider.supports({ ...def, backend: 'sql' })).toBe(false);
  });

  it('templates the namespace into the seed request and applies baseUrl + auth', async () => {
    const http = fakeHttpClient();
    const provider = new ApiDataProvider(http, {
      baseUrl: 'https://api.test',
      authHeader: 'Bearer TOKEN',
    });
    const records = await provider.seed(def, 'pr482');

    expect(http.requests[0]!.method).toBe('POST');
    expect(http.requests[0]!.url).toBe('https://api.test/customers');
    expect(http.requests[0]!.headers?.Authorization).toBe('Bearer TOKEN');
    expect(http.requests[0]!.body).toEqual({ email: 'primary+pr482@test.warden' });
    expect(records[0]!.fields.email).toBe('primary+pr482@test.warden');
  });

  it('templates the namespace into the teardown path', async () => {
    const http = fakeHttpClient(200);
    const provider = new ApiDataProvider(http, { baseUrl: 'https://api.test' });
    await provider.teardown(def, 'pr482');
    expect(http.requests[0]!.method).toBe('DELETE');
    expect(http.requests[0]!.url).toBe('https://api.test/customers/pr482');
  });

  it('throws E_FIXTURE_API on a >=400 response', async () => {
    const provider = new ApiDataProvider(fakeHttpClient(500));
    await expect(provider.seed(def, 'ns')).rejects.toMatchObject({ code: 'E_FIXTURE_API' });
  });

  it('throws E_FIXTURE_INVALID when the template is not valid JSON', async () => {
    const provider = new ApiDataProvider(fakeHttpClient());
    await expect(provider.seed({ ...def, seed: 'not json' }, 'ns')).rejects.toMatchObject({
      code: 'E_FIXTURE_INVALID',
    });
  });
});
