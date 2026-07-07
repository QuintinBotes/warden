/**
 * A tiny leveled logger. The whole platform logs through this interface so output can be
 * captured (tests), silenced, or redirected (CI job summaries) via a single `sink`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to `'info'`. */
  level?: LogLevel;
  /** Where entries go. Defaults to `console`. */
  sink?: (entry: LogEntry) => void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const consoleSink = (entry: LogEntry): void => {
  const line = `[${entry.level}] ${entry.message}`;
  if (entry.level === 'error') console.error(line, entry.data ?? '');
  else if (entry.level === 'warn') console.warn(line, entry.data ?? '');
  else console.log(line, entry.data ?? '');
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = ORDER[options.level ?? 'info'];
  const sink = options.sink ?? consoleSink;

  const emit =
    (level: LogLevel) =>
    (message: string, data?: unknown): void => {
      if (ORDER[level] >= threshold) sink({ level, message, data });
    };

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
}
