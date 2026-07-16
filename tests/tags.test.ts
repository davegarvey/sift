import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeTag } from '../src/util/tags';

describe('normalizeTag', () => {
  it('trims whitespace', () => {
    expect(normalizeTag('  rust  ')).toBe('rust');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeTag('web  dev')).toBe('web dev');
  });

  it('lowercases', () => {
    expect(normalizeTag('Rust')).toBe('rust');
    expect(normalizeTag('DEEP DIVE')).toBe('deep dive');
  });

  it('handles mixed case with spaces', () => {
    expect(normalizeTag('  Web  Dev  ')).toBe('web dev');
  });

  it('handles empty string', () => {
    expect(normalizeTag('')).toBe('');
  });

  it('rejects whitespace-only string', () => {
    expect(normalizeTag('   ')).toBe('');
  });
});
