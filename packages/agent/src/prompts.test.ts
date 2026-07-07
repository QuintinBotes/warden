import { describe, it, expect } from 'vitest';
import {
  EXPLORATORY_SYSTEM_PROMPT,
  GENERATIVE_SYSTEM_PROMPT,
  HEALER_SYSTEM_PROMPT,
} from './prompts';

describe('system prompts', () => {
  it('exports non-empty exploratory, generative and healer prompts', () => {
    for (const prompt of [
      EXPLORATORY_SYSTEM_PROMPT,
      GENERATIVE_SYSTEM_PROMPT,
      HEALER_SYSTEM_PROMPT,
    ]) {
      expect(typeof prompt).toBe('string');
      expect(prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it('carries the intent of each strategy', () => {
    expect(EXPLORATORY_SYSTEM_PROMPT).toMatch(/QA engineer/i);
    expect(GENERATIVE_SYSTEM_PROMPT).toMatch(/Playwright/i);
    expect(HEALER_SYSTEM_PROMPT).toMatch(/regression/i);
  });
});
