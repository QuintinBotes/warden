import { describe, expect, it } from 'vitest';
import { ProviderError, type RecordedSession } from '@warden/core';
import { fakeProvider } from '@warden/core/testing';
import {
  AiTestSynthesizer,
  createSynthesizer,
  dedupeFlows,
  parseFlows,
  renderSpec,
  type SynthFlow,
} from './ai-test-synthesizer';

const SESSION: RecordedSession = {
  url: 'https://app.test/',
  startedAt: new Date('2026-07-07T09:00:00.000Z'),
  steps: [
    { action: 'goto', value: 'https://app.test/' },
    { action: 'click', selector: 'button:Add to cart', value: 'Add to cart' },
  ],
};

const loginFlow: SynthFlow = {
  name: 'Login',
  tags: ['@auth'],
  steps: [
    { kind: 'goto', url: 'https://app.test/login' },
    { kind: 'fill', label: 'Email', value: 'a@b.com' },
    { kind: 'click', role: 'button', name: 'Sign in' },
    { kind: 'expectVisible', text: 'Welcome' },
  ],
};

const signupFlow: SynthFlow = {
  name: 'Sign up',
  tags: ['@onboarding'],
  steps: [
    { kind: 'goto', url: 'https://app.test/signup' },
    { kind: 'fill', label: 'Email', value: 'a@b.com' },
    { kind: 'click', role: 'button', name: 'Create account' },
  ],
};

function providerReturning(flows: SynthFlow[]) {
  return fakeProvider({ text: JSON.stringify({ flows }) });
}

describe('AiTestSynthesizer.synthesize', () => {
  it('emits valid, tagged GeneratedTests with role-based locators for distinct flows', async () => {
    const provider = providerReturning([loginFlow, signupFlow]);
    const tests = await createSynthesizer().synthesize(SESSION, provider);

    expect(tests).toHaveLength(2);
    for (const t of tests) {
      expect(typeof t.path).toBe('string');
      expect(t.path).toMatch(/^tests\/generated\/.+\.spec\.ts$/);
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.tags).toContain('@e2e');
      expect(t.content).toContain("import { test, expect } from '@playwright/test';");
    }

    const login = tests.find((t) => t.path.includes('login'))!;
    expect(login.tags).toEqual(['@e2e', '@auth']);
    expect(login.content).toContain('page.getByLabel("Email").fill("a@b.com")');
    expect(login.content).toContain('page.getByRole("button", { name: "Sign in" }).click()');
    expect(login.content).toContain('await expect(page.getByText("Welcome")).toBeVisible()');

    // Distinct flow names produce distinct paths.
    expect(new Set(tests.map((t) => t.path)).size).toBe(2);
  });

  it('drives the provider via generateText with a prompt built from the session', async () => {
    const provider = providerReturning([loginFlow]);
    await new AiTestSynthesizer().synthesize(SESSION, provider);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.method).toBe('generateText');
    expect(provider.calls[0]!.prompt).toContain('https://app.test/');
  });

  it('dedupes: an overlapping (subset) flow is removed', async () => {
    // `Add to cart` is a strict subset of `Checkout`, so it must be dropped.
    const checkout: SynthFlow = {
      name: 'Checkout',
      tags: ['@checkout'],
      steps: [
        { kind: 'goto', url: 'https://app.test/' },
        { kind: 'click', role: 'button', name: 'Add to cart' },
        { kind: 'click', role: 'button', name: 'Checkout' },
        { kind: 'fill', label: 'Card', value: '4242' },
      ],
    };
    const addToCart: SynthFlow = {
      name: 'Add to cart',
      tags: ['@cart'],
      steps: [
        { kind: 'goto', url: 'https://app.test/' },
        { kind: 'click', role: 'button', name: 'Add to cart' },
      ],
    };

    const provider = providerReturning([checkout, addToCart]);
    const tests = await createSynthesizer().synthesize(SESSION, provider);

    expect(tests).toHaveLength(1);
    expect(tests[0]!.path).toBe('tests/generated/checkout.spec.ts');
  });

  it('parses JSON wrapped in a markdown fence', async () => {
    const provider = fakeProvider({
      text: '```json\n' + JSON.stringify({ flows: [loginFlow] }) + '\n```',
    });
    const tests = await createSynthesizer().synthesize(SESSION, provider);
    expect(tests).toHaveLength(1);
  });

  it('throws a ProviderError on unparseable output', async () => {
    const provider = fakeProvider({ text: 'not json at all' });
    await expect(createSynthesizer().synthesize(SESSION, provider)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('throws a ProviderError when the flow schema is invalid', async () => {
    const provider = fakeProvider({ text: JSON.stringify({ flows: [{ name: '', steps: [] }] }) });
    await expect(createSynthesizer().synthesize(SESSION, provider)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});

describe('dedupeFlows', () => {
  it('collapses identical flows to one', () => {
    expect(dedupeFlows([loginFlow, loginFlow])).toHaveLength(1);
  });

  it('keeps genuinely distinct flows', () => {
    const kept = dedupeFlows([loginFlow, signupFlow]);
    expect(kept.map((f) => f.name)).toEqual(['Login', 'Sign up']);
  });
});

describe('parseFlows', () => {
  it('defaults tags to an empty array', () => {
    const flows = parseFlows(
      JSON.stringify({ flows: [{ name: 'X', steps: [{ kind: 'goto', url: 'u' }] }] }),
    );
    expect(flows[0]!.tags).toEqual([]);
  });
});

describe('renderSpec', () => {
  it('merges base tags with flow tags and uses a tagged test block', () => {
    const { content, tags } = renderSpec(loginFlow, 'https://app.test/', ['@e2e', '@smoke']);
    expect(tags).toEqual(['@e2e', '@smoke', '@auth']);
    expect(content).toContain("{ tag: ['@e2e', '@smoke', '@auth'] }");
  });
});
