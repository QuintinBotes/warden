import type { PluginHookEvent, QAPlatformPlugin } from '@warden/core';

/**
 * The result of invoking one plugin's matching hook for a single {@link PluginHookEvent}.
 * `firePluginHooks` returns one of these per plugin so a caller (or the CLI's logger /
 * metrics emitter) can observe delivery without the failure ever becoming an exception.
 */
export interface PluginHookOutcome {
  plugin: string;
  hook: PluginHookEvent['hook'];
  ok: boolean;
  error?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Invokes the matching optional hook on every plugin for one `PluginHookEvent`, in parallel.
 *
 * A plugin that has no handler for this hook, throws synchronously, or rejects never affects
 * its siblings or the caller — failures are captured and returned as `{ ok: false, error }`,
 * never thrown, so a bad Slack webhook (or any other misbehaving plugin) can never fail the
 * test run or block the merge gate.
 *
 * Callers are expected to invoke this from a single call site per lifecycle point, in the
 * order documented on `QAPlatformPlugin` (`onPROpened` → `onTestExecutionStart` →
 * `onTestExecutionComplete` → `onBugFound` → `onGateDecision`) — plugins that cache context
 * across hooks (see `@warden/notifications`) depend on that ordering.
 */
export async function firePluginHooks(
  plugins: QAPlatformPlugin[],
  event: PluginHookEvent,
): Promise<PluginHookOutcome[]> {
  return Promise.all(
    plugins.map(async (plugin): Promise<PluginHookOutcome> => {
      try {
        switch (event.hook) {
          case 'onPROpened':
            await plugin.onPROpened?.(event.pr);
            break;
          case 'onTestExecutionStart':
            await plugin.onTestExecutionStart?.(event.execution);
            break;
          case 'onTestExecutionComplete':
            await plugin.onTestExecutionComplete?.(event.execution, event.results);
            break;
          case 'onBugFound':
            await plugin.onBugFound?.(event.bug);
            break;
          case 'onGateDecision':
            await plugin.onGateDecision?.(event.decision);
            break;
        }
        return { plugin: plugin.name, hook: event.hook, ok: true };
      } catch (err) {
        return { plugin: plugin.name, hook: event.hook, ok: false, error: errMsg(err) };
      }
    }),
  );
}
