/**
 * Warden error hierarchy. Every thrown error in the platform is a `WardenError`
 * (or a subclass) carrying a stable machine-readable `code`, so callers can branch
 * on `err.code` rather than parsing messages.
 */
export class WardenError extends Error {
  readonly code: string;

  constructor(message: string, code = 'E_GENERIC') {
    super(message);
    this.name = 'WardenError';
    this.code = code;
  }
}

/** Configuration could not be loaded or failed validation. */
export class ConfigError extends WardenError {
  constructor(message: string) {
    super(message, 'E_CONFIG');
    this.name = 'ConfigError';
  }
}

/** An LLM provider failed or is not available (e.g. missing API key, v2-only provider). */
export class ProviderError extends WardenError {
  constructor(message: string) {
    super(message, 'E_PROVIDER');
    this.name = 'ProviderError';
  }
}

/** A browser engine or session operation failed. */
export class BrowserError extends WardenError {
  constructor(message: string) {
    super(message, 'E_BROWSER');
    this.name = 'BrowserError';
  }
}

/** The quality gate blocked a merge; thrown when a hard gate must halt the pipeline. */
export class GateBlockedError extends WardenError {
  constructor(message: string) {
    super(message, 'E_GATE_BLOCKED');
    this.name = 'GateBlockedError';
  }
}
