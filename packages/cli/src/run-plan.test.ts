import { describe, expect, it } from 'vitest';
import { runPlan } from './run-plan';

describe('runPlan', () => {
  it('returns the canonical Test Plan Markdown template', () => {
    const markdown = runPlan();
    expect(markdown).toContain('Test Plan');
    expect(markdown).toContain('### 1. Objective');
    expect(markdown).toContain('### 2. Scope');
    expect(markdown).toContain('### 3. Test Items');
    expect(markdown).toContain('### 4. Test Approach');
    expect(markdown).toContain('### 5. Test Environment');
    expect(markdown).toContain('### 6. Entry Criteria');
    expect(markdown).toContain('### 7. Exit Criteria');
    expect(markdown).toContain('### 8. Risks & Mitigations');
    expect(markdown).toContain('### 9. Sign-off');
  });

  it('substitutes a given name into the heading', () => {
    const markdown = runPlan({ name: 'Checkout Revamp' });
    expect(markdown).toContain('## Test Plan: Checkout Revamp');
  });

  it('defaults to a placeholder name when none is given', () => {
    const markdown = runPlan();
    expect(markdown).toContain('## Test Plan: [Feature or Release Name]');
  });
});
