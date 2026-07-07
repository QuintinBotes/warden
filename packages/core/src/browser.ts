import type { ZodType } from 'zod';

/**
 * Browser engine abstraction. Deterministic interactions (`click`/`fill`/`goto`) and
 * AI-driven ones (`act`/`extract`) live behind one interface so Playwright (CI default),
 * the Claude-in-Chrome extension (`claude-chrome`, local-first), and Stagehand (v2) are
 * interchangeable via config.
 */

export interface BrowserLaunchOptions {
  headless: boolean;
  viewport: { width: number; height: number };
  timeout: number;
  baseUrl?: string;
}

export interface PageState {
  url: string;
  title: string;
  text: string;
}

export interface BrowserSession {
  goto(url: string): Promise<void>;
  /** Deterministic, role-based interaction (Playwright-style). */
  click(role: string, name: string): Promise<void>;
  fill(label: string, value: string): Promise<void>;
  /** AI/dynamic action from a natural-language instruction (Claude-Chrome or Stagehand). */
  act(instruction: string): Promise<void>;
  extract<T>(instruction: string, schema: ZodType<T>): Promise<T>;
  screenshot(path: string): Promise<void>;
  readPage(): Promise<PageState>;
  setViewport(width: number, height: number): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserEngine {
  name: 'playwright' | 'claude-chrome' | 'stagehand';
  launch(opts: BrowserLaunchOptions): Promise<BrowserSession>;
}
