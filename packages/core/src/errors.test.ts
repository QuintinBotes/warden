import { describe, it, expect } from 'vitest';
import { WardenError, ConfigError, ProviderError, BrowserError, GateBlockedError } from './errors';

describe('WardenError', () => {
  it('is an Error carrying a name and a code', () => {
    const e = new WardenError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('WardenError');
    expect(e.code).toBe('E_GENERIC');
    expect(e.message).toBe('boom');
  });

  it('subclasses extend WardenError with their own name and code', () => {
    const c = new ConfigError('bad config');
    expect(c).toBeInstanceOf(WardenError);
    expect(c.name).toBe('ConfigError');
    expect(c.code).toBe('E_CONFIG');
    expect(new ProviderError('x').code).toBe('E_PROVIDER');
    expect(new BrowserError('x').code).toBe('E_BROWSER');
    expect(new GateBlockedError('blocked').code).toBe('E_GATE_BLOCKED');
  });

  it('is catchable as a plain Error', () => {
    try {
      throw new ProviderError('no api key');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as ProviderError).code).toBe('E_PROVIDER');
    }
  });
});
