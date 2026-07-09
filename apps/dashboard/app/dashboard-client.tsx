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

interface CoverageSyncRun {
  id: string;
  sourcePr: string;
  targetRepo: string;
  add: number;
  update: number;
  remove: number;
  kinds: { test: number; doc: number };
  draftPr: string;
  status: 'open' | 'merged';
  at: string;
}

type CujStatus = 'HEALTHY' | 'DEGRADED' | 'AT_RISK' | 'BROKEN';

interface CujJourney {
  id: string;
  name: string;
  status: CujStatus;
  team: string;
  testCount: number;
  passRate: number;
  touched: boolean;
  steps: { name: string; status: CujStatus }[];
}

type VisualStatus = 'MATCH' | 'VISUAL_DIFF' | 'NEW_BASELINE';

interface VisualCheck {
  id: string;
  module: string;
  viewport: string;
  theme: 'light' | 'dark';
  status: VisualStatus;
  changedRatio: number;
  rationale?: string;
}

type FlakeRootCause = 'timing' | 'selector' | 'data' | 'network' | 'unknown';

interface FlakeOffender {
  testName: string;
  flakeRate: number;
  rootCause: FlakeRootCause;
  reRunsCaused: number;
  ciMinutesLost: number;
}

interface FlakeTrend {
  points: { at: string; flakeRate: number; newlyFlagged: number; deflaked: number }[];
  topOffenders: FlakeOffender[];
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
  coverageSync: CoverageSyncRun[];
  cujBoard: CujJourney[];
  visual: VisualCheck[];
  flakeTrend: FlakeTrend;
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

function pct(ratio: number) {
  return `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`;
}

function FlakeSparkline({ points }: { points: FlakeTrend['points'] }) {
  const w = 260;
  const h = 44;
  const max = Math.max(0.0001, ...points.map((p) => p.flakeRate));
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const coords = points
    .map((p, i) => {
      const x = i * step;
      const y = h - 4 - (p.flakeRate / max) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = points[points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="wd-spark"
      role="img"
      aria-label={`Flake rate trend, latest ${last ? pct(last.flakeRate) : 'n/a'}`}
    >
      <polyline points={coords} fill="none" stroke="var(--flaky)" strokeWidth="2" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={(i * step).toFixed(1)}
          cy={(h - 4 - (p.flakeRate / max) * (h - 8)).toFixed(1)}
          r={i === points.length - 1 ? 3 : 1.6}
          fill="var(--flaky)"
        />
      ))}
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

      {/* Coverage sync */}
      <section className="wd-block wd-section">
        <SectionHead
          eyebrow="Coverage sync"
          title="Coverage Sync"
          subtitle={`${data.coverageSync.length} draft PRs across linked repos`}
        />
        <div className="wd-panel">
          {data.coverageSync.length === 0 ? (
            <p className="wd-empty">No linked repos need tests or docs right now.</p>
          ) : (
            data.coverageSync.map((s) => {
              const target = s.targetRepo === 'self' ? 'this repo' : s.targetRepo;
              return (
                <div className="wd-sync-item" key={s.id}>
                  <span className="wd-sync-route">
                    <span className="wd-sync-src">{s.sourcePr}</span>
                    <span className="wd-sync-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="wd-sync-target">{target}</span>
                  </span>
                  <span className="wd-sync-pills">
                    <span className="wd-sync-pill wd-sync-pill--add">+{s.add} add</span>
                    <span className="wd-sync-pill wd-sync-pill--update">~{s.update} update</span>
                    <span className="wd-sync-pill wd-sync-pill--remove">−{s.remove} remove</span>
                  </span>
                  <span className="wd-sync-kinds">
                    {s.kinds.test} test · {s.kinds.doc} doc
                  </span>
                  <a className="wd-sync-chip" href="#" aria-label={`Open draft PR: ${s.draftPr}`}>
                    {s.draftPr}
                  </a>
                  <span
                    className={`wd-sync-status wd-sync-status--${s.status}`}
                    data-status={s.status}
                  >
                    <span className="wd-sync-status-dot" aria-hidden="true" />
                    {s.status}
                  </span>
                  <span className="wd-sync-at">{s.at}</span>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Critical User Journeys */}
      <section className="wd-block wd-section">
        <SectionHead
          eyebrow="Journeys"
          title="Critical User Journeys"
          subtitle={`${data.cujBoard.filter((c) => c.touched).length} touched by this change`}
        />
        <div className="wd-panel">
          {data.cujBoard.map((c) => (
            <div className="wd-cuj-item" key={c.id}>
              <span className="wd-cuj-head">
                <span className="wd-cuj-name">{c.name}</span>
                <span className="wd-cuj-team">{c.team}</span>
                {c.touched ? <span className="wd-cuj-touched">touched by PR</span> : null}
              </span>
              <span className="wd-cuj-steps" aria-hidden="false">
                {c.steps.map((s, i) => (
                  <span
                    key={i}
                    className={`wd-cuj-step wd-sev--${s.status}`}
                    title={`${s.name}: ${s.status}`}
                    aria-label={`${s.name}: ${s.status}`}
                  />
                ))}
              </span>
              <span className="wd-cuj-meta">
                {pct(c.passRate)} pass · {c.testCount} tests
              </span>
              <span className={`wd-badge wd-sev--${c.status}`} data-status={c.status}>
                <span className="wd-badge-dot" aria-hidden="true" />
                {c.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Visual Regression */}
      <section className="wd-block wd-section">
        <SectionHead
          eyebrow="Visual"
          title="Visual Regression"
          subtitle={`${data.visual.filter((v) => v.status === 'VISUAL_DIFF').length} diffs to review`}
        />
        <div className="wd-panel">
          {data.visual.map((v) => (
            <div className="wd-visual-item" key={v.id}>
              <span className="wd-visual-id">
                <span className="wd-visual-module">{v.module}</span>
                <span className="wd-visual-ctx">
                  {v.viewport} · {v.theme}
                </span>
              </span>
              <span className={`wd-badge wd-vis--${v.status}`} data-status={v.status}>
                <span className="wd-badge-dot" aria-hidden="true" />
                {v.status.replace('_', ' ')}
              </span>
              <span className="wd-visual-ratio">{pct(v.changedRatio)} changed</span>
              <span className="wd-visual-why">{v.rationale ?? ''}</span>
              {v.status === 'MATCH' ? (
                <span className="wd-visual-ok" aria-hidden="true">
                  ✓
                </span>
              ) : (
                <button
                  className="wd-chip-btn"
                  type="button"
                  disabled
                  title="Approve in CLI: warden visual approve"
                >
                  Approve baseline
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Flake Intelligence */}
      <section className="wd-block wd-section">
        <SectionHead
          eyebrow="Reliability"
          title="Flake Intelligence"
          subtitle="Flake rate over time · top offenders by impact"
        />
        <div className="wd-panel wd-flakeint">
          <div className="wd-flakeint-trend">
            <FlakeSparkline points={data.flakeTrend.points} />
            <span className="wd-flakeint-legend">
              flake rate — latest{' '}
              <strong>
                {data.flakeTrend.points.length
                  ? pct(data.flakeTrend.points[data.flakeTrend.points.length - 1]!.flakeRate)
                  : 'n/a'}
              </strong>
            </span>
          </div>
          <ul className="wd-offenders">
            {data.flakeTrend.topOffenders.map((o, i) => (
              <li className="wd-offender" key={i}>
                <span className="wd-offender-name">{o.testName}</span>
                <span className="wd-offender-cause">{o.rootCause}</span>
                <span className="wd-badge wd-sev--DEGRADED">{pct(o.flakeRate)} flaky</span>
                <span className="wd-offender-cost">
                  {o.reRunsCaused} re-runs · {o.ciMinutesLost}m lost
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

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
