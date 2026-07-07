import { describe, it, expect } from 'vitest';
import {
  fakeProvider,
  fakeBrowserSession,
  fakeReporter,
  fixtureChangeSurface,
  fixtureExecution,
} from './fakes';
import { TestExecutionSchema } from '../schema';
import type { WardenConfig } from '../config';

describe('fakes', () => {
  it('fakeProvider returns canned text and records the prompt', async () => {
    const p = fakeProvider({ text: 'hi' });
    expect(await p.generateText('prompt-1')).toBe('hi');
    expect(p.calls[0]).toEqual({ method: 'generateText', prompt: 'prompt-1' });
  });

  it('fakeReporter records every execution it reports', async () => {
    const r = fakeReporter();
    await r.report(fixtureExecution(), { config: {} as WardenConfig, artifactsDir: '/tmp' });
    expect(r.reported).toHaveLength(1);
    expect(r.reported[0]?.id).toBe('EX-1');
  });

  it('fakeBrowserSession records actions and returns a page state', async () => {
    const b = fakeBrowserSession();
    await b.goto('http://localhost:3000/checkout');
    await b.click('button', 'Sign in');
    const page = await b.readPage();
    expect(b.actions).toContain('goto http://localhost:3000/checkout');
    expect(page.url).toContain('http');
  });

  it('fixtureExecution is schema-valid and fixtureChangeSurface carries risk', () => {
    expect(() => TestExecutionSchema.parse(fixtureExecution())).not.toThrow();
    expect(fixtureChangeSurface().riskScore).toBe(5);
    expect(fixtureChangeSurface({ riskScore: 9 }).riskScore).toBe(9);
  });
});
