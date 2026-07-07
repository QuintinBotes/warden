import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const monitoringDir = fileURLToPath(new URL('../monitoring/', import.meta.url));

describe('monitoring/grafana-dashboard.json', () => {
  const raw = readFileSync(`${monitoringDir}grafana-dashboard.json`, 'utf-8');

  it('parses as JSON', () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has a title and a non-empty panels array', () => {
    const dashboard = JSON.parse(raw);

    expect(typeof dashboard.title).toBe('string');
    expect(dashboard.title.length).toBeGreaterThan(0);
    expect(Array.isArray(dashboard.panels)).toBe(true);
    expect(dashboard.panels.length).toBeGreaterThan(0);
  });

  it('every panel has an id, title, type, and at least one PromQL target', () => {
    const dashboard = JSON.parse(raw);

    for (const panel of dashboard.panels) {
      expect(typeof panel.id).toBe('number');
      expect(typeof panel.title).toBe('string');
      expect(typeof panel.type).toBe('string');
      expect(Array.isArray(panel.targets)).toBe(true);
      expect(panel.targets.length).toBeGreaterThan(0);
      for (const target of panel.targets) {
        expect(typeof target.expr).toBe('string');
        expect(target.expr.length).toBeGreaterThan(0);
      }
    }
  });

  it('covers pass rate, flake, MTTR, escaped-defect, duration, and coverage-delta', () => {
    const dashboard = JSON.parse(raw);
    const titles = dashboard.panels.map((p: { title: string }) => p.title.toLowerCase());

    expect(titles.some((t: string) => t.includes('pass rate'))).toBe(true);
    expect(titles.some((t: string) => t.includes('flake'))).toBe(true);
    expect(titles.some((t: string) => t.includes('mttr'))).toBe(true);
    expect(titles.some((t: string) => t.includes('escaped defect'))).toBe(true);
    expect(titles.some((t: string) => t.includes('duration'))).toBe(true);
    expect(titles.some((t: string) => t.includes('coverage delta'))).toBe(true);
  });

  it('panel ids are unique', () => {
    const dashboard = JSON.parse(raw);
    const ids = dashboard.panels.map((p: { id: number }) => p.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('monitoring/prometheus.yml', () => {
  const raw = readFileSync(`${monitoringDir}prometheus.yml`, 'utf-8');

  it('defines a scrape job targeting the pushgateway', () => {
    expect(raw).toMatch(/job_name:\s*pushgateway/);
    expect(raw).toMatch(/pushgateway:9091/);
  });
});

describe('monitoring/docker-compose.yml', () => {
  const raw = readFileSync(`${monitoringDir}docker-compose.yml`, 'utf-8');

  it('defines the pushgateway, prometheus, and grafana services', () => {
    expect(raw).toMatch(/\n {2}pushgateway:/);
    expect(raw).toMatch(/\n {2}prometheus:/);
    expect(raw).toMatch(/\n {2}grafana:/);
  });

  it('mounts the prometheus config and grafana dashboard', () => {
    expect(raw).toContain('./prometheus.yml:/etc/prometheus/prometheus.yml');
    expect(raw).toContain(
      './grafana-dashboard.json:/var/lib/grafana/dashboards/warden-quality.json',
    );
  });
});
