// scripts/result-tags.mjs
//
// Tag derivation for the dashboard's result rows. Split out of snapshot.mjs because it is
// the one part of the snapshot that makes a claim about a test rather than counting one,
// and because it imports nothing, so it can be asserted on directly.
//
// A tag on a row is read as a fact about the test. Both functions here are held to that.

/**
 * Module label derived from a demo requirement / test id (`REQ-AUTH-001` → `Auth`).
 *
 * Only meaningful for the seeded demo dataset, whose ids are written by hand in this
 * repository and really do have a module in the second `-` separated position. A real
 * `testCaseId` is a content hash (`TC-958794d4`) and this returns the hash.
 */
export function moduleOf(id) {
  const token = id.split('-')[1] ?? '';
  return token.charAt(0) + token.slice(1).toLowerCase();
}

/**
 * Tags for a result out of a real store.
 *
 * The only grouping a runner actually reports is where the test lives: CTRF's `filePath`,
 * or its `suite` for the runners (Vitest, Jest) that name a suite instead. That is the
 * whole list. It used to also emit a hardcoded `'e2e'`, which was false for every unit
 * test ever loaded, and `moduleOf(testCaseId)`, which on a real content-hash id yields the
 * hash — 3,231 tags, each occurring exactly once, which no one can filter on.
 *
 * When a result carries neither, it gets no tags. An empty row is honest; a placeholder
 * tag is a grouping the dashboard invented and the reader would believe.
 */
export function realResultTags(result) {
  const grouping = result.filePath ?? result.suite;
  if (typeof grouping !== 'string') return [];
  const trimmed = grouping.trim();
  return trimmed === '' ? [] : [trimmed];
}

/**
 * Tags for a result out of the seeded demo dataset.
 *
 * The demo path keeps its module lookup because the demo ids are `TC-AUTH-001`-shaped by
 * construction, and keeps `'e2e'` because the dataset it labels is a synthesised end-to-end
 * run — screenshots, traces and browser flows. Both are true of that data and of nothing
 * else, which is why no real store is ever routed through here.
 */
export function demoResultTags(result) {
  return [moduleOf(result.testCaseId).toLowerCase(), 'e2e'];
}
