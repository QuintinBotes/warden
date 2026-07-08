import type { FixtureDef, FixtureRecord } from '@warden/core';

/**
 * Namespace templating shared by the SQL and API providers. Every seed/teardown script and every
 * `provides` field value may embed the `{{ns}}` token, which is substituted with the run namespace
 * so two runs (parallel shards, two PRs) never read or clobber each other's seeded data.
 */

const NS_TOKEN = /\{\{\s*ns\s*\}\}/g;

/** Replaces every `{{ns}}` occurrence in `template` with `namespace`. */
export function renderTemplate(template: string, namespace: string): string {
  return template.replace(NS_TOKEN, namespace);
}

/** True when a template references the `{{ns}}` token at least once. */
export function referencesNamespace(template: string): boolean {
  NS_TOKEN.lastIndex = 0;
  return NS_TOKEN.test(template);
}

/**
 * Returns a copy of `records` with `{{ns}}` substituted in every string field value, so the
 * catalog handed to tests/agents carries the concrete namespaced values (e.g. the seeded email
 * `primary+pr482@test.warden`) rather than the raw template.
 */
export function namespaceRecords(records: FixtureRecord[], namespace: string): FixtureRecord[] {
  return records.map((record) => ({
    entity: record.entity,
    key: record.key,
    fields: Object.fromEntries(
      Object.entries(record.fields).map(([key, value]) => [
        key,
        typeof value === 'string' ? renderTemplate(value, namespace) : value,
      ]),
    ),
  }));
}

const IDENTITY_FIELD = /(e?mail|username|user_name|login|slug|handle|external_?id)/i;

/**
 * Lint-time check (never a hard failure): warns when a fixture declares identity-like `provides`
 * fields (email/username/…) but its seed script does not reference `{{ns}}`, which risks a
 * cross-run collision in a target system with unique-identity constraints.
 */
export function lintFixtureNamespace(def: FixtureDef): string[] {
  if (referencesNamespace(def.seed)) return [];
  const warnings: string[] = [];
  for (const record of def.provides) {
    for (const field of Object.keys(record.fields)) {
      if (IDENTITY_FIELD.test(field)) {
        warnings.push(
          `fixture "${def.id}" declares identity-like field "${record.key}.${field}" ` +
            'but its seed does not reference {{ns}} — parallel runs may collide',
        );
      }
    }
  }
  return warnings;
}
