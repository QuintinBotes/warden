import { describe, expect, it } from 'vitest';
import { CTRFReportSchema } from '@warden/core';
import { evaluateZapGate, zapJsonToCtrf, zapSeverityToGate, type ZapReport } from './zap';

const zapReport: ZapReport = {
  '@version': '2.14.0',
  site: [
    {
      '@name': 'https://example.com',
      alerts: [
        {
          alert: 'Cross Site Scripting (Reflected)',
          riskcode: '3',
          riskdesc: 'High (Medium)',
          cweid: '79',
          tags: { OWASP_2021_A03: 'https://owasp.org/Top10/A03_2021-Injection/' },
          instances: [{ uri: 'https://example.com/search' }, { uri: 'https://example.com/q' }],
        },
        {
          alert: 'Cookie without SameSite Attribute',
          riskcode: '1',
          riskdesc: 'Low (Medium)',
          cweid: '1275',
          instances: [{ uri: 'https://example.com/' }],
        },
        {
          alert: 'Information Disclosure - Suspicious Comments',
          riskcode: '0',
          riskdesc: 'Informational (Low)',
          cweid: '200',
          instances: [{ uri: 'https://example.com/app.js' }],
        },
      ],
    },
  ],
};

describe('zapJsonToCtrf', () => {
  it('produces a CTRFReportSchema-valid report', () => {
    const report = zapJsonToCtrf(zapReport);
    expect(CTRFReportSchema.safeParse(report).success).toBe(true);
  });

  it('sets the tool to zap with the report version', () => {
    const report = zapJsonToCtrf(zapReport);
    expect(report.results.tool.name).toBe('zap');
    expect(report.results.tool.version).toBe('2.14.0');
  });

  it('emits one test per alert across all sites', () => {
    expect(zapJsonToCtrf(zapReport).results.tests).toHaveLength(3);
  });

  it('maps riskcode to severity and fails risky alerts, marks informational as other', () => {
    const { tests } = zapJsonToCtrf(zapReport).results;
    const xss = tests.find((t) => t.name === 'Cross Site Scripting (Reflected)');
    const cookie = tests.find((t) => t.name === 'Cookie without SameSite Attribute');
    const info = tests.find((t) => t.name === 'Information Disclosure - Suspicious Comments');
    expect(xss?.status).toBe('failed');
    expect(xss?.extra?.severity).toBe('high');
    expect(cookie?.status).toBe('failed');
    expect(cookie?.extra?.severity).toBe('low');
    expect(info?.status).toBe('other');
    expect(info?.extra?.severity).toBe('informational');
  });

  it('carries the OWASP category in tags and extra', () => {
    const { tests } = zapJsonToCtrf(zapReport).results;
    const xss = tests.find((t) => t.name === 'Cross Site Scripting (Reflected)');
    expect(xss?.extra?.owaspCategory).toBe('OWASP_2021_A03');
    expect(xss?.tags).toContain('OWASP_2021_A03');
    expect(xss?.tags).toContain('high');
  });

  it('falls back to "uncategorized" when no OWASP tag is present', () => {
    const { tests } = zapJsonToCtrf(zapReport).results;
    const cookie = tests.find((t) => t.name === 'Cookie without SameSite Attribute');
    expect(cookie?.extra?.owaspCategory).toBe('uncategorized');
  });

  it('summarises failed vs other counts', () => {
    const { summary } = zapJsonToCtrf(zapReport).results;
    expect(summary).toMatchObject({ tests: 3, failed: 2, other: 1, passed: 0 });
  });
});

describe('zapSeverityToGate', () => {
  it('maps a high-severity alert to BLOCK', () => {
    expect(zapSeverityToGate('high').decision).toBe('BLOCK');
  });

  it('maps a medium-severity alert to WARN', () => {
    expect(zapSeverityToGate('medium').decision).toBe('WARN');
  });

  it('maps low/informational to PASS', () => {
    expect(zapSeverityToGate('low').decision).toBe('PASS');
    expect(zapSeverityToGate('informational').decision).toBe('PASS');
  });
});

describe('evaluateZapGate', () => {
  it('BLOCKs a report containing a high-severity finding', () => {
    const gate = evaluateZapGate(zapJsonToCtrf(zapReport));
    expect(gate.decision).toBe('BLOCK');
    expect(gate.reason).toContain('high');
  });

  it('WARNs when the worst finding is medium', () => {
    const mediumOnly: ZapReport = {
      site: [
        {
          '@name': 'https://example.com',
          alerts: [{ alert: 'Something Medium', riskcode: '2', riskdesc: 'Medium (Low)' }],
        },
      ],
    };
    expect(evaluateZapGate(zapJsonToCtrf(mediumOnly)).decision).toBe('WARN');
  });

  it('PASSes when there are no findings above low', () => {
    const lowOnly: ZapReport = {
      site: [
        {
          '@name': 'https://example.com',
          alerts: [{ alert: 'A Low Thing', riskcode: '1', riskdesc: 'Low (Low)' }],
        },
      ],
    };
    expect(evaluateZapGate(zapJsonToCtrf(lowOnly)).decision).toBe('PASS');
  });
});
