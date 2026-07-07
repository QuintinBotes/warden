import { describe, it, expect } from 'vitest';
import { createLogger, type LogEntry } from './logger';

describe('createLogger', () => {
  it('routes messages to the sink with their level', () => {
    const seen: LogEntry[] = [];
    const log = createLogger({ level: 'debug', sink: (e) => seen.push(e) });
    log.info('hello', { a: 1 });
    log.error('boom');
    expect(seen).toEqual([
      { level: 'info', message: 'hello', data: { a: 1 } },
      { level: 'error', message: 'boom', data: undefined },
    ]);
  });

  it('drops entries below the configured level', () => {
    const seen: LogEntry[] = [];
    const log = createLogger({ level: 'warn', sink: (e) => seen.push(e) });
    log.debug('nope');
    log.info('nope');
    log.warn('kept');
    log.error('kept');
    expect(seen.map((e) => e.message)).toEqual(['kept', 'kept']);
  });
});
