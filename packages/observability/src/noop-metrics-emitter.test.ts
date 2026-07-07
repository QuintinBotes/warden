import { fixtureExecution } from '@warden/core/testing';
import { describe, expect, it } from 'vitest';
import { NoopMetricsEmitter } from './noop-metrics-emitter.js';

describe('NoopMetricsEmitter', () => {
  it('resolves without throwing for emitExecution and emitGate', async () => {
    const emitter = new NoopMetricsEmitter();

    await expect(emitter.emitExecution(fixtureExecution())).resolves.toBeUndefined();
    await expect(
      emitter.emitGate({ decision: 'PASS', reason: 'ok' }, { pr: 1 }),
    ).resolves.toBeUndefined();
  });
});
