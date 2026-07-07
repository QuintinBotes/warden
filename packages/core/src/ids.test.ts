import { describe, it, expect } from 'vitest';
import { sequentialId, contentId } from './ids';

describe('ids', () => {
  it('sequentialId zero-pads to at least three digits behind a prefix', () => {
    expect(sequentialId('TC', 1)).toBe('TC-001');
    expect(sequentialId('TC', 42)).toBe('TC-042');
    expect(sequentialId('TC', 1000)).toBe('TC-1000');
  });

  it('contentId is deterministic for identical input', () => {
    const a = contentId('exec', 'PR-89:checkout');
    const b = contentId('exec', 'PR-89:checkout');
    expect(a).toBe(b);
    expect(a.startsWith('exec-')).toBe(true);
  });

  it('contentId separates different input', () => {
    expect(contentId('exec', 'a')).not.toBe(contentId('exec', 'b'));
  });
});
