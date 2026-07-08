export type { CreateIntegrationDeps } from './create-integration.js';
export { createIntegration } from './create-integration.js';
export type { FetchLike, FetchResponseLike } from './fetch-like.js';
export type { GithubProjectsAdapterOptions } from './github-projects-adapter.js';
export { GithubProjectsAdapter } from './github-projects-adapter.js';
export type { JiraAdapterOptions } from './jira-adapter.js';
export { JiraAdapter } from './jira-adapter.js';
export type { LinearAdapterOptions } from './linear-adapter.js';
export { LinearAdapter } from './linear-adapter.js';
export { mapLabelsToRequirementType, mapStateNameToCoverageStatus } from './status-mapping.js';

// ── Test-Management Sync (tms/) — bi-directional, ID-stable sync with an external TMS ─────────
export type { CreateTmsDeps } from './tms/create-tms.js';
export { createTestManagementSync } from './tms/create-tms.js';
export {
  externalIdTag,
  externalIdFromTestCase,
  injectExternalId,
  parseExternalId,
  sourceRefFromTestCase,
  withExternalId,
} from './tms/id-convention.js';
export type {
  CatalogEntryStatus,
  CatalogReconciliation,
  ReconciledEntry,
} from './tms/catalog-merge.js';
export { reconcileCatalog } from './tms/catalog-merge.js';
export type { ResultMapping } from './tms/result-status.js';
export { mapResultStatus } from './tms/result-status.js';
export type { TestomatioAdapterOptions } from './tms/testomatio-adapter.js';
export { TestomatioAdapter } from './tms/testomatio-adapter.js';
export type { QaseAdapterOptions } from './tms/qase-adapter.js';
export { QaseAdapter } from './tms/qase-adapter.js';
export type { TestRailAdapterOptions } from './tms/testrail-adapter.js';
export { TestRailAdapter } from './tms/testrail-adapter.js';
export type { XrayAdapterOptions } from './tms/xray-adapter.js';
export { XrayAdapter } from './tms/xray-adapter.js';
export type { ZephyrAdapterOptions } from './tms/zephyr-adapter.js';
export { ZephyrAdapter } from './tms/zephyr-adapter.js';
export type { AllureTestOpsAdapterOptions } from './tms/allure-testops-adapter.js';
export { AllureTestOpsAdapter } from './tms/allure-testops-adapter.js';
