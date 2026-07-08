# Sentinel — the Warden Design System

Sentinel is the visual language of Warden's dashboard, docs, and brand. It is a **dark-first command center** built on one idea: in a QA tool, **test status is the most important information on the screen**, so status *is* the palette.

> **Live reference:** the interactive design system (logo, palette, typography, components, themes, and a live quality-gate demo) is published as a self-contained page. Open [`sentinel-design-system.html`](design/sentinel-design-system.html) in a browser, or view the hosted artifact linked from the project.

## Principles

- **Status is the palette.** The six test statuses are the loudest, most deliberate colors in the system; everything else stays quiet so they carry.
- **The portcullis is the mark.** Warden guards a quality gate, so the logo is a portcullis — and the same shape becomes the live verdict in the product.
- **Console voice, prose warmth.** Tracked uppercase monospace speaks for the machine (headings, verdicts, IDs, data); a humanist sans carries anything a human wrote.

## Status color roles

| Role | Meaning |
|------|---------|
| `PASS` | Test passed |
| `FAIL` | Test failed |
| `FLAKY` | Non-deterministic |
| `BLOCKED` | Blocked by a dependency |
| `SKIPPED` | Not run |
| `QUARANTINED` | Isolated flaky test |

The beacon-gold brand accent is deliberately **not** a status color, so a glowing UI element is never mistaken for a warning.

## Themes

Three themes ship, all tuned for WCAG AA:

| Theme | Ground | Use |
|-------|--------|-----|
| **Signal** (default) | near-black | Maximum legibility, high contrast. |
| **Watch** | slate-teal | Warmer command-center dark. |
| **Day** | warm paper | Light, for daylight review. |

## Typography

Self-hosted **Fira Code** (mono — display, verdicts, data) paired with **Fira Sans** (humanist — body). No web-font CDN dependency.

## Using it in code

The tokens and components ship as `@warden/design-system`: status color roles, the three themes (as `data-theme`), the portcullis logo as SVG, and the dashboard primitives — `VerdictCard`, `StatusPill`, `CoverageMatrix`, `TestResultRow`, `TrendTile`, `ThemeToggle`, and `ReplayViewer`.
