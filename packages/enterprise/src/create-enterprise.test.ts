import { describe, it, expect } from 'vitest';
import {
  ConfigError,
  defineConfig,
  type GateDecision,
  type GitHubAccess,
  type PrRef,
} from '@warden/core';
import { createEnterprise } from './create-enterprise.js';
import { noopAuditSink, openAuthProvider } from './noop.js';

const pr: PrRef = { owner: 'acme', repo: 'web', number: 1, headSha: 'a', headRef: 'f' };
const block: GateDecision = { decision: 'BLOCK', reason: 'r' };

function noopGitHub(): GitHubAccess & { checkRuns: string[] } {
  const checkRuns: string[] = [];
  return {
    checkRuns,
    async openOrUpdateDraftPr() {
      return { url: '', number: 0 };
    },
    async addPrSuggestions() {},
    async postCheckRun(_pr, conclusion) {
      checkRuns.push(conclusion);
    },
  };
}

describe('createEnterprise — mode: none (self-hosted default)', () => {
  it('wires the permissive no-op surface (openAuthProvider + noopAuditSink)', () => {
    const enterprise = createEnterprise(defineConfig({}));
    expect(enterprise.mode).toBe('none');
    expect(enterprise.auditEnabled).toBe(false);
    expect(enterprise.authProvider).toBe(openAuthProvider);
    expect(enterprise.auditSink).toBe(noopAuditSink);
  });

  it('lets the implicit admin override a gate (works, unaudited) — the OSS default', async () => {
    const enterprise = createEnterprise(defineConfig({}));
    const principal = await enterprise.authProvider.verify('any');
    const gh = noopGitHub();
    const handler = enterprise.createGateOverrideHandler(gh);

    const amended = await handler.override({ principal, pr, decision: block, reason: 'manual' });

    expect(amended.overridden).toBe(true);
    expect(gh.checkRuns).toEqual(['success']); // the check-run still flips
    expect(await enterprise.auditSink.query({ tenant: principal.tenant })).toEqual([]); // not audited
  });
});

describe('createEnterprise — mode: oidc (hosted)', () => {
  it('throws ConfigError when OIDC config is missing (never falls back to open auth)', () => {
    const cfg = defineConfig({ enterprise: { auth: { mode: 'oidc' } } });
    expect(() => createEnterprise(cfg)).toThrow(ConfigError);
  });

  it('auto-enables audit and requires an audit db path', () => {
    const cfg = defineConfig({ enterprise: { auth: { mode: 'oidc' } } });
    expect(() =>
      createEnterprise(cfg, {
        oidc: {
          issuer: 'https://idp/',
          audience: 'aud',
          jwks: {
            async getKey() {
              return new Uint8Array(32);
            },
          },
          resolveTenant: () => ({ id: 't', name: 'T' }),
          roleMapping: () => ({ groupToRole: {}, defaultRole: 'viewer' }),
        },
        // auditDbPath deliberately omitted -> audit is auto-on for oidc -> ConfigError
      }),
    ).toThrow(ConfigError);
  });

  it('builds an OIDC auth provider + sqlite audit sink when fully configured', async () => {
    const cfg = defineConfig({ enterprise: { auth: { mode: 'oidc' } } });
    const enterprise = createEnterprise(cfg, {
      auditDbPath: ':memory:',
      oidc: {
        issuer: 'https://idp/',
        audience: 'aud',
        jwks: {
          async getKey() {
            return new Uint8Array(32);
          },
        },
        resolveTenant: () => ({ id: 't', name: 'T' }),
        roleMapping: () => ({ groupToRole: {}, defaultRole: 'viewer' }),
      },
    });
    expect(enterprise.mode).toBe('oidc');
    expect(enterprise.auditEnabled).toBe(true);
    // a real sqlite sink round-trips
    const recorded = await enterprise.auditSink.record({
      tenant: { id: 't', name: 'T' },
      actor: { subject: 's', email: 'e@x.com' },
      action: 'login',
      resource: { type: 'session', id: 's1' },
      detail: '',
    });
    expect(await enterprise.auditSink.query({ tenant: { id: 't', name: 'T' } })).toHaveLength(1);
    expect(recorded.action).toBe('login');
  });
});
