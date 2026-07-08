/**
 * `@warden/core` — the contract surface. Everything the platform shares lives here:
 * domain schemas, the CTRF report format, and the provider / browser / reporter / agent /
 * plugin interfaces that every other package implements. Waves 1–3 depend only on this.
 *
 * Test doubles and fixtures are published separately at `@warden/core/testing`.
 */
export * from './errors';
export * from './ids';
export * from './schema';
export * from './ctrf';
export * from './change-surface';
export * from './llm';
export * from './browser';
export * from './reporter';
export * from './agent';
export * from './plugin';
export * from './config';
export * from './logger';
export * from './v2';
export * from './coverage-sync';
export * from './visual';
