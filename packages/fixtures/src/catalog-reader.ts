import type { FixtureCatalog, FixtureRecord } from '@warden/core';

/**
 * `FixtureCatalogReader` — renders a {@link FixtureCatalog} as a compact, LLM-friendly summary
 * (entity → key → example values) for `AgentInput.fixtures`. The output is bounded by a documented
 * size cap so a large catalog can never blow the prompt budget: records are emitted until the cap
 * is reached, then a truncation notice is appended.
 */

/** Documented default cap (characters) for the rendered summary. */
export const DEFAULT_CATALOG_SUMMARY_CAP = 2000;

export interface CatalogSummaryOptions {
  /** Maximum length of the rendered summary in characters. Defaults to {@link DEFAULT_CATALOG_SUMMARY_CAP}. */
  maxChars?: number;
}

function formatValue(value: string | number | boolean | null): string {
  return value === null ? 'null' : String(value);
}

function renderRecord(record: FixtureRecord): string {
  const fields = Object.entries(record.fields)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(', ');
  return `- ${record.entity}.${record.key}: ${fields}`;
}

/**
 * Renders the catalog to a prompt-ready string. Every record line names its declared key (so the
 * model can map it back to `catalog.get('<key>')`), its entity, and example field values.
 */
export function renderFixtureCatalog(
  catalog: FixtureCatalog,
  options: CatalogSummaryOptions = {},
): string {
  const cap = options.maxChars ?? DEFAULT_CATALOG_SUMMARY_CAP;
  const header =
    `Seeded fixtures (namespace ${catalog.namespace}). Prefer these keyed values over invented ` +
    `literals — reference each by its key via catalog.get('<key>'):`;

  const lines = [header];
  let truncated = 0;
  for (let i = 0; i < catalog.records.length; i++) {
    const record = catalog.records[i];
    if (!record) continue;
    const line = renderRecord(record);
    const candidate = [...lines, line].join('\n');
    if (candidate.length > cap) {
      truncated = catalog.records.length - i;
      break;
    }
    lines.push(line);
  }

  if (truncated > 0) {
    lines.push(`… (${truncated} more record(s) omitted to stay within the prompt budget)`);
  }

  // Hard guarantee the documented cap, even if the header alone (a misconfigured, tiny cap) or the
  // appended truncation notice would otherwise push the summary over budget.
  const summary = lines.join('\n');
  return summary.length > cap ? summary.slice(0, cap) : summary;
}
