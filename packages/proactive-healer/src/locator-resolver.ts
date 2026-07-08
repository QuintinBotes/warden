import type { BrowserSession, LocatorRef, LocatorResolution, LocatorStatus } from '@warden/core';

/**
 * A {@link BrowserSession} that can non-mutatingly probe whether a role/label locator resolves.
 *
 * The optional `locate()` is implemented by the Playwright engine in `@warden/runner`
 * (`page.getByRole(role, { name }).count()` / `page.getByLabel(name).count()`). AI-driven
 * engines (`claude-chrome`, `stagehand`) have no stable locator surface to probe and simply omit
 * it — the resolver then no-ops with a stated reason rather than pretending everything resolved.
 * `locate` is optional, so any plain `BrowserSession` is assignable here.
 */
export interface LocatingSession extends BrowserSession {
  locate?(kind: 'click' | 'fill', role: string, name: string): Promise<{ matchCount: number }>;
}

export interface ResolveLocatorsResult {
  resolutions: LocatorResolution[];
  /** Present only when the pass was skipped wholesale (engine has no `locate()`). */
  skippedReason?: string;
}

/**
 * Re-resolves each locator against a running preview session via `session.locate(...)`:
 * `matchCount === 1` → `resolved`, `0` → `missing`, `> 1` → `ambiguous`.
 *
 * When the session's engine does not implement `locate()`, returns an empty result with a
 * `skippedReason` — never a fabricated set of `resolved` results.
 */
export async function resolveLocators(
  refs: LocatorRef[],
  session: LocatingSession,
): Promise<ResolveLocatorsResult> {
  const locate = session.locate;
  if (typeof locate !== 'function') {
    return {
      resolutions: [],
      skippedReason: 'browser engine does not implement locate(); proactive healing skipped',
    };
  }

  const resolutions: LocatorResolution[] = [];
  for (const locator of refs) {
    const { matchCount } = await locate.call(session, locator.kind, locator.role, locator.name);
    resolutions.push({ locator, status: statusFor(matchCount), matchCount });
  }
  return { resolutions };
}

function statusFor(matchCount: number): LocatorStatus {
  if (matchCount === 1) return 'resolved';
  if (matchCount === 0) return 'missing';
  return 'ambiguous';
}
