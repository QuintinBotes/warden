import type { Artifact, Priority, TestCase, TestStatus } from './schema';

/**
 * The `TestManagementSync` seam — a sibling to `IntegrationAdapter`. Where `IntegrationAdapter`
 * syncs *requirements* against an issue tracker, this syncs *tests / specs / results* against an
 * external test-management system (testomat.io, Qase, TestRail, Xray, Zephyr, Allure TestOps).
 *
 * The seam is bi-directional and ID-stable: the external tool owns the stable `externalId`, Warden
 * carries it in-band as a tag on the local `TestCase`, and every operation is idempotent by that id.
 * This file is purely additive to `@warden/core`; no existing schema changes.
 */

/** Which external test-management system is the source of truth. */
export type TmsSource = 'testomatio' | 'qase' | 'testrail' | 'xray' | 'zephyr' | 'allure-testops';

/** Where a source-code-first tool maps a spec back to code. */
export interface SourceCodeRef {
  filePath: string;
  testName: string;
  framework: 'playwright' | 'cypress' | 'codeceptjs' | 'gherkin';
}

/** A canonical spec pulled from the external system. `externalId` is STABLE and owned by the tool. */
export interface SpecCatalogEntry {
  /** Stable id: testomat.io `@T…`, Qase case id, TestRail `C###`, Xray/Zephyr key, Allure `AS…`. */
  externalId: string;
  title: string;
  tags: string[];
  /** Linked issues/requirements in the tool (e.g. Jira keys). */
  requirementIds: string[];
  priority?: Priority;
  automation: 'automated' | 'manual';
  /** Present when the tool maintains a Gherkin Steps Database (testomat.io). */
  bddSteps?: string[];
  /** Present for source-code-first tools. */
  sourceRef?: SourceCodeRef;
}

/** A test Warden wants to create or update in the external system. */
export interface TmsTestUpsert {
  /** Present ⇒ update; absent ⇒ create (the tool mints the stable id). */
  externalId?: string;
  title: string;
  tags: string[];
  requirementIds: string[];
  priority: Priority;
  /** Reuses core `TestCase['source']`: 'manual' | 'ai-generated' | 'recorded'. */
  source: TestCase['source'];
  /** The generated/proposed spec's file + test name. */
  sourceRef?: SourceCodeRef;
  bddSteps?: string[];
}

/** The stable handle the tool returns after an upsert. */
export interface TmsTestRef {
  externalId: string;
  url?: string;
}

/** One per-test outcome, keyed by stable id, pushed back as part of a Run. */
export interface TmsResultPush {
  externalId: string;
  /** Reuses core `TestStatus`: PASS | FAIL | SKIP | BLOCKED | FLAKY. */
  status: TestStatus;
  durationMs: number;
  errorMessage?: string;
  artifacts?: Artifact[];
}

/** Metadata for the Run that a batch of results is pushed under. */
export interface TmsRunMeta {
  /** PR number, commit SHA, or execution id. */
  runRef: string;
  environment: string;
  startedAt: Date;
  completedAt?: Date;
}

/** Bi-directional, ID-stable sync with an external test-management system. */
export interface TestManagementSync {
  readonly source: TmsSource;
  /** True when the tool reads tests source-code-first (a rename in code updates the tool). */
  readonly sourceCodeFirst: boolean;
  /** Pull the canonical spec catalog — the tool owns the ids. */
  pullCatalog(): Promise<SpecCatalogEntry[]>;
  /** Create or update one test, respecting the tool's stable ids. Idempotent by `externalId`. */
  upsertTest(test: TmsTestUpsert): Promise<TmsTestRef>;
  /** Push results as a Run, keyed by stable id. */
  pushResults(results: TmsResultPush[], meta: TmsRunMeta): Promise<void>;
}
