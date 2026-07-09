import type { GridCapability } from '@warden/core';
import { stripTrailingSlashes } from '@warden/core';
import type { WebdriverLike, WebdriverElementLike } from './appium';

/**
 * Points the existing {@link AppiumBrowserSession} at a remote grid's WebDriver endpoint — no new
 * session class for real-device lanes. {@link createGridWebdriver} builds a {@link WebdriverLike}
 * that speaks the W3C WebDriver protocol over an injected {@link GridWebdriverHttp} handle, so
 * `createAppiumSession(createGridWebdriver(...))` drives a real device while staying hermetic in
 * tests (the http handle is a fake that records requests).
 */

/** The minimal HTTP verbs the grid WebDriver bridge needs; injected so the bridge is testable. */
export interface GridWebdriverHttp {
  post<T = unknown>(url: string, body?: unknown): Promise<T>;
  get<T = unknown>(url: string): Promise<T>;
  del<T = unknown>(url: string): Promise<T>;
}

/** W3C element responses put the element id under this magic key; older drivers use `ELEMENT`. */
const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecc';

interface W3CValue<T = unknown> {
  value?: T;
}

function extractElementId(res: unknown): string {
  const value = (res as W3CValue<Record<string, string>>)?.value ?? {};
  return value[W3C_ELEMENT_KEY] ?? value['ELEMENT'] ?? '';
}

/** Translate an Appium-style selector (`~AccessibilityId`) into a W3C locator strategy. */
function toLocator(selector: string): { using: string; value: string } {
  if (selector.startsWith('~')) return { using: 'accessibility id', value: selector.slice(1) };
  return { using: 'css selector', value: selector };
}

/** Build the W3C `alwaysMatch` capabilities payload for a grid lane. */
export function toW3CCapabilities(capability: GridCapability): Record<string, unknown> {
  const caps: Record<string, unknown> = {
    browserName: capability.browser,
    platformName: capability.platform,
  };
  if (capability.browserVersion !== undefined) caps.browserVersion = capability.browserVersion;
  if (capability.device !== undefined) caps['appium:deviceName'] = capability.device;
  if (capability.platformVersion !== undefined)
    caps['appium:platformVersion'] = capability.platformVersion;
  return caps;
}

/**
 * Build a {@link WebdriverLike} bound to `endpoint` for `capability`, driving it over `http`. The
 * WebDriver session is created lazily on first use — the session-creation POST carries the lane's
 * capabilities to `endpoint`, and every subsequent command is scoped to the returned session id.
 */
export function createGridWebdriver(
  endpoint: string,
  capability: GridCapability,
  http: GridWebdriverHttp,
): WebdriverLike {
  const base = stripTrailingSlashes(endpoint);
  let sessionId: string | undefined;

  async function ensureSession(): Promise<string> {
    if (sessionId !== undefined) return sessionId;
    const res = await http.post<W3CValue<{ sessionId?: string }> & { sessionId?: string }>(
      `${base}/session`,
      { capabilities: { alwaysMatch: toW3CCapabilities(capability) } },
    );
    sessionId = res.value?.sessionId ?? res.sessionId ?? '';
    return sessionId;
  }

  async function sessionBase(): Promise<string> {
    return `${base}/session/${await ensureSession()}`;
  }

  return {
    async url(url: string): Promise<void> {
      await http.post(`${await sessionBase()}/url`, { url });
    },
    async $(selector: string): Promise<WebdriverElementLike> {
      const sb = await sessionBase();
      const res = await http.post(`${sb}/element`, toLocator(selector));
      const elementId = extractElementId(res);
      return {
        async click(): Promise<void> {
          await http.post(`${sb}/element/${elementId}/click`, {});
        },
        async setValue(value: string): Promise<void> {
          await http.post(`${sb}/element/${elementId}/value`, { text: value });
        },
      };
    },
    async saveScreenshot(path: string): Promise<void> {
      const res = await http.get<W3CValue<string>>(`${await sessionBase()}/screenshot`);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, Buffer.from(res.value ?? '', 'base64'));
    },
    async getUrl(): Promise<string> {
      const res = await http.get<W3CValue<string>>(`${await sessionBase()}/url`);
      return res.value ?? '';
    },
    async getTitle(): Promise<string> {
      const res = await http.get<W3CValue<string>>(`${await sessionBase()}/title`);
      return res.value ?? '';
    },
    async getPageSource(): Promise<string> {
      const res = await http.get<W3CValue<string>>(`${await sessionBase()}/source`);
      return res.value ?? '';
    },
    async setWindowSize(width: number, height: number): Promise<void> {
      await http.post(`${await sessionBase()}/window/rect`, { width, height });
    },
    async deleteSession(): Promise<void> {
      if (sessionId === undefined) return;
      await http.del(`${base}/session/${sessionId}`);
      sessionId = undefined;
    },
  };
}
