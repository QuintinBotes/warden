import type { ZodType } from 'zod';
import { BrowserError, type BrowserSession, type PageState } from '@warden/core';

/**
 * The Appium mobile session — drives a native/mobile-web app through an INJECTED WebdriverIO-style
 * driver ({@link WebdriverLike}). Injecting the driver keeps the session hermetically
 * unit-testable: a fake driver records calls with no real device, emulator, or Appium server.
 *
 * Appium is deterministic-only. `click`/`fill` resolve elements by accessibility id (`~name`);
 * the AI-driven `act`/`extract` throw, since those require the `claude-chrome` or `stagehand`
 * engine rather than a mobile driver.
 */

/** A single element handle from the injected driver. */
export interface WebdriverElementLike {
  click(): Promise<void>;
  setValue(value: string): Promise<void>;
}

/** The minimal WebdriverIO/Appium driver surface {@link AppiumBrowserSession} depends on. */
export interface WebdriverLike {
  /** Navigate the (mobile web) session to a URL. */
  url(url: string): Promise<void>;
  /** Resolve a single element by selector (e.g. `~AccessibilityId`). */
  $(selector: string): Promise<WebdriverElementLike>;
  /** Save a screenshot to a file path. */
  saveScreenshot(path: string): Promise<void>;
  getUrl(): Promise<string>;
  getTitle(): Promise<string>;
  getPageSource(): Promise<string>;
  setWindowSize(width: number, height: number): Promise<void>;
  /** Terminate the Appium session. */
  deleteSession(): Promise<void>;
}

const NO_AI_ACTIONS =
  'requires the claude-chrome or stagehand engine; the appium session only supports deterministic interactions';

export class AppiumBrowserSession implements BrowserSession {
  constructor(private readonly driver: WebdriverLike) {}

  async goto(url: string): Promise<void> {
    await this.driver.url(url);
  }

  /** Resolve by accessibility id built from `name` and click it (`role` is advisory on mobile). */
  async click(_role: string, name: string): Promise<void> {
    const el = await this.driver.$(`~${name}`);
    await el.click();
  }

  async fill(label: string, value: string): Promise<void> {
    const el = await this.driver.$(`~${label}`);
    await el.setValue(value);
  }

  async act(_instruction: string): Promise<void> {
    throw new BrowserError(`act() ${NO_AI_ACTIONS}`);
  }

  async extract<T>(_instruction: string, _schema: ZodType<T>): Promise<T> {
    throw new BrowserError(`extract() ${NO_AI_ACTIONS}`);
  }

  async screenshot(path: string): Promise<void> {
    await this.driver.saveScreenshot(path);
  }

  async readPage(): Promise<PageState> {
    return {
      url: await this.driver.getUrl(),
      title: await this.driver.getTitle(),
      text: await this.driver.getPageSource(),
    };
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.driver.setWindowSize(width, height);
  }

  async close(): Promise<void> {
    await this.driver.deleteSession();
  }
}

/** Factory: wrap an injected {@link WebdriverLike} driver in an {@link AppiumBrowserSession}. */
export function createAppiumSession(driver: WebdriverLike): BrowserSession {
  return new AppiumBrowserSession(driver);
}
