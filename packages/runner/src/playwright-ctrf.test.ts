import { describe, expect, it } from 'vitest';
import { CTRFReportSchema, type CTRFTest } from '@warden/core';
import { playwrightJsonToCtrf } from './playwright-ctrf';

const playwrightJson = {
  config: { version: '1.61.1' },
  stats: { startTime: '2026-07-07T12:00:00.000Z', duration: 1234 },
  suites: [
    {
      title: 'checkout.spec.ts',
      file: 'e2e/checkout.spec.ts',
      specs: [
        {
          title: 'completes a purchase',
          file: 'e2e/checkout.spec.ts',
          tags: ['@smoke', '@apps/checkout'],
          tests: [
            { status: 'expected', results: [{ status: 'passed', duration: 500, attachments: [] }] },
          ],
        },
        {
          title: 'shows an error when the card is declined',
          file: 'e2e/checkout.spec.ts',
          tags: ['@regression'],
          tests: [
            {
              status: 'unexpected',
              results: [
                {
                  status: 'failed',
                  duration: 700,
                  error: {
                    message: 'Expected element to be visible',
                    stack: 'Error: Expected element to be visible\n    at checkout.spec.ts:42',
                  },
                  attachments: [
                    { name: 'screenshot', contentType: 'image/png', path: '/artifacts/shot.png' },
                    { name: 'video', contentType: 'video/webm', path: '/artifacts/vid.webm' },
                    { name: 'trace', contentType: 'application/zip', path: '/artifacts/trace.zip' },
                  ],
                },
              ],
            },
          ],
        },
      ],
      suites: [
        {
          title: 'edge cases',
          file: 'e2e/checkout.spec.ts',
          specs: [
            {
              title: 'is skipped in preview',
              file: 'e2e/checkout.spec.ts',
              tests: [
                {
                  status: 'skipped',
                  results: [{ status: 'skipped', duration: 0, attachments: [] }],
                },
              ],
            },
            {
              title: 'times out talking to the gateway',
              file: 'e2e/checkout.spec.ts',
              tests: [
                {
                  status: 'unexpected',
                  results: [{ status: 'timedOut', duration: 30000, attachments: [] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function byName(tests: CTRFTest[], name: string): CTRFTest {
  const found = tests.find((t) => t.name === name);
  if (!found) throw new Error(`no CTRF test named ${name}`);
  return found;
}

describe('playwrightJsonToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const report = playwrightJsonToCtrf(playwrightJson, { toolVersion: '1.61.1' });
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool to playwright with the given version', () => {
    const report = playwrightJsonToCtrf(playwrightJson, { toolVersion: '9.9.9' });
    expect(report.results.tool.name).toBe('playwright');
    expect(report.results.tool.version).toBe('9.9.9');
  });

  it('walks nested suites and converts every spec', () => {
    const report = playwrightJsonToCtrf(playwrightJson);
    expect(report.results.tests).toHaveLength(4);
  });

  it('maps playwright statuses passed/failed/skipped/timedOut', () => {
    const { tests } = playwrightJsonToCtrf(playwrightJson).results;
    expect(byName(tests, 'completes a purchase').status).toBe('passed');
    expect(byName(tests, 'shows an error when the card is declined').status).toBe('failed');
    expect(byName(tests, 'is skipped in preview').status).toBe('skipped');
    expect(byName(tests, 'times out talking to the gateway').status).toBe('failed');
  });

  it('carries name, duration, message, filePath and tags', () => {
    const { tests } = playwrightJsonToCtrf(playwrightJson).results;
    const passing = byName(tests, 'completes a purchase');
    expect(passing.duration).toBe(500);
    expect(passing.filePath).toBe('e2e/checkout.spec.ts');
    expect(passing.tags).toEqual(['@smoke', '@apps/checkout']);

    const failing = byName(tests, 'shows an error when the card is declined');
    expect(failing.message).toContain('Expected element to be visible');
  });

  it('puts captured media paths (video/screenshot/trace) into extra', () => {
    const { tests } = playwrightJsonToCtrf(playwrightJson).results;
    const failing = byName(tests, 'shows an error when the card is declined');
    expect(failing.extra).toMatchObject({
      screenshot: '/artifacts/shot.png',
      video: '/artifacts/vid.webm',
      trace: '/artifacts/trace.zip',
    });
  });

  it('computes a summary with per-status counts', () => {
    const { summary } = playwrightJsonToCtrf(playwrightJson).results;
    expect(summary).toMatchObject({
      tests: 4,
      passed: 1,
      failed: 2,
      skipped: 1,
      pending: 0,
      other: 0,
    });
    expect(summary.start).toBe(Date.parse('2026-07-07T12:00:00.000Z'));
    expect(summary.stop).toBe(summary.start + 1234);
  });
});
