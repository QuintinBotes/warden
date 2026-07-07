'use client';

import { useState } from 'react';
import {
  applyTheme,
  CoverageMatrix,
  PortcullisLogo,
  ReplayViewer,
  StatusPill,
  TestResultRow,
  ThemeToggle,
  TrendTile,
  VerdictCard,
  type CoverageMatrixRow,
  type SentinelStatus,
  type Theme,
  type TrendDirection,
  type TrendTone,
  type VerdictDecision,
} from '@warden/design-system';

// ---------------------------------------------------------------------------
// Snapshot shape (produced by scripts/snapshot.mjs → app/generated/data.json).
// ---------------------------------------------------------------------------

interface Kpi {
  label: string;
  value: string;
  delta: string;
  trend: TrendDirection;
  tone: TrendTone;
  points: number[];
}

interface Gate {
  decision: VerdictDecision;
  reason: string;
  meta: { label: string; value: string }[];
}

interface Replay {
  errorMessage: string | null;
  screenshots: string[];
  tracePath: string;
}

interface ResultRow {
  id: string;
  name: string;
  durationMs: number;
  tags: string[];
  status: SentinelStatus;
  replay: Replay | null;
}

interface FlakeRow {
  testCaseId: string;
  name: string;
  flakeRate: number;
  ratePct: number;
  quarantined: boolean;
  pill: SentinelStatus;
}

interface Learning {
  title: string;
  durationLabel: string;
  embedId: string;
}

export interface DashboardData {
  generatedAt: string;
  run: {
    trigger: string;
    environment: string;
    ranAt: string;
    requirementCount: number;
    testCount: number;
  };
  kpis: { passRate: Kpi; flakeRate: Kpi; mttr: Kpi; coverage: Kpi };
  latestGate: Gate;
  coverageColumns: string[];
  coverageRows: CoverageMatrixRow[];
  results: ResultRow[];
  defaultSelectedId: string | null;
  flake: FlakeRow[];
  learning: Learning[];
}

// ---------------------------------------------------------------------------
// Small presentational helpers.
// ---------------------------------------------------------------------------

function SectionHead({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="wd-section-head">
      <div>
        <p className="wd-eyebrow">{eyebrow}</p>
        <h2 className="wd-title">{title}</h2>
      </div>
      {subtitle ? <p className="wd-subtitle">{subtitle}</p> : null}
    </header>
  );
}

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M3 2.2v9.6a.6.6 0 0 0 .92.5l7.4-4.8a.6.6 0 0 0 0-1L3.92 1.7A.6.6 0 0 0 3 2.2Z" />
    </svg>
  );
}

function formatGenerated(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Dashboard.
// ---------------------------------------------------------------------------

export default function DashboardClient({ data }: { data: DashboardData }) {
  const [theme, setTheme] = useState<Theme>('signal');
  const [selectedId, setSelectedId] = useState<string | null>(data.defaultSelectedId);

  function onTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  const kpis = [data.kpis.passRate, data.kpis.flakeRate, data.kpis.mttr, data.kpis.coverage];
  const selected = data.results.find((r) => r.id === selectedId) ?? null;
  const failing = data.results.filter((r) => r.status === 'FAIL' || r.status === 'BLOCKED').length;

  return (
    <main className="wd-shell">
      {/* Top bar */}
      <div className="wd-topbar">
        <div className="wd-brand">
          <PortcullisLogo size={30} title="Warden" />
          <span className="wd-wordmark">Warden</span>
          <span className="wd-brand-tag">Quality gate</span>
        </div>
        <div className="wd-topbar-right">
          <span className="wd-run-context">
            <b>{data.run.trigger}</b> · {data.run.environment} · {data.run.ranAt}
          </span>
          <ThemeToggle theme={theme} onChange={onTheme} />
        </div>
      </div>

      {/* KPI trends */}
      <section className="wd-block wd-section">
        <SectionHead
          eyebrow="Signals"
          title="Trends over the last 5 runs"
          subtitle="vs. previous run"
        />
        <div className="wd-kpis">
          {kpis.map((k) => (
            <TrendTile
              key={k.label}
              label={k.label}
              value={k.value}
              delta={k.delta}
              tone={k.tone}
              trend={k.trend}
              points={k.points}
            />
          ))}
        </div>
      </section>

      {/* Coverage + gate */}
      <div className="wd-block wd-split wd-split--cov">
        <section className="wd-section">
          <SectionHead
            eyebrow="Coverage"
            title="Requirement health"
            subtitle="Newest run at right"
          />
          <CoverageMatrix rows={data.coverageRows} />
        </section>
        <section className="wd-section">
          <SectionHead eyebrow="Quality gate" title="Latest verdict" />
          <VerdictCard
            decision={data.latestGate.decision}
            reason={data.latestGate.reason}
            meta={data.latestGate.meta}
          />
        </section>
      </div>

      {/* Results + replay */}
      <div className="wd-block wd-split wd-split--results">
        <section className="wd-section">
          <SectionHead
            eyebrow="Latest run"
            title="Test results"
            subtitle={`${data.results.length} tests · ${failing} failing`}
          />
          <div className="wd-panel">
            <div className="wd-rows" role="list">
              {data.results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="wd-row-btn"
                  role="listitem"
                  data-selected={r.id === selectedId}
                  aria-pressed={r.id === selectedId}
                  onClick={() => setSelectedId(r.id)}
                >
                  <TestResultRow
                    name={r.name}
                    durationMs={r.durationMs}
                    tags={r.tags}
                    status={r.status}
                  />
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="wd-section">
          <SectionHead
            eyebrow="Replay"
            title={selected ? selected.name : 'Replay'}
            subtitle={selected?.replay?.errorMessage ?? undefined}
          />
          <ReplayViewer
            screenshots={selected?.replay?.screenshots}
            tracePath={selected?.replay?.tracePath}
          />
        </section>
      </div>

      {/* Flake + learning */}
      <div className="wd-block wd-split wd-split--flake">
        <section className="wd-section">
          <SectionHead
            eyebrow="Stability"
            title="Flake & quarantine"
            subtitle={`${data.flake.filter((f) => f.quarantined).length} quarantined`}
          />
          <div className="wd-panel">
            {data.flake.length === 0 ? (
              <p className="wd-empty">Every tracked test is stable.</p>
            ) : (
              data.flake.map((f) => (
                <div className="wd-flake-item" key={f.testCaseId}>
                  <span className="wd-flake-name">{f.name}</span>
                  <span className="wd-flake-rate">{f.ratePct}%</span>
                  <StatusPill status={f.pill} />
                  <div className="wd-meter">
                    <div
                      className="wd-meter-fill"
                      data-status={f.pill}
                      style={{ width: `${Math.max(f.ratePct, 4)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="wd-section">
          <SectionHead
            eyebrow="Learning"
            title="Generated from failures"
            subtitle={`${data.learning.length} modules`}
          />
          <div className="wd-panel">
            {data.learning.map((l) => (
              <article className="wd-learn-item" key={l.embedId}>
                <span className="wd-learn-play">
                  <PlayGlyph />
                </span>
                <div className="wd-learn-body">
                  <p className="wd-learn-title">{l.title}</p>
                  <p className="wd-learn-meta">
                    <span>{l.durationLabel}</span>
                    <span>{l.embedId}</span>
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="wd-footer">
        <span className="wd-footer-brand">
          <PortcullisLogo size={16} />
          Warden · Sentinel design system
        </span>
        <span>Generated {formatGenerated(data.generatedAt)}</span>
      </footer>
    </main>
  );
}
