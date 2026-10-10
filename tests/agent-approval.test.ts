import { describe, expect, it } from 'vitest';
import { accessSummary, isSafeRedirect, normaliseApprovalCode } from '../src/agents/approval';

describe('normaliseApprovalCode', () => {
  it('ignores case, spaces and hyphens', () => {
    expect(normaliseApprovalCode(' ABCD-2345 ')).toBe('abcd2345');
    expect(normaliseApprovalCode('ab cd 23 45')).toBe('abcd2345');
  });

  it('extracts the code from a scanned URL', () => {
    expect(normaliseApprovalCode('https://sift.example/connect?code=ABCD-2345')).toBe('abcd2345');
    expect(normaliseApprovalCode('https://sift.example/connect')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(normaliseApprovalCode('abc')).toBeNull();
    expect(normaliseApprovalCode('abcdefg1')).toBeNull();
    expect(normaliseApprovalCode('')).toBeNull();
  });
});

describe('helpers', () => {
  it('words access by scope', () => {
    expect(accessSummary(['read', 'write'])).toContain('change your subscriptions and reading state');
    expect(accessSummary(['read'])).toContain('cannot change anything');
  });

  it('rejects script-like redirects', () => {
    expect(isSafeRedirect('cursor://app/cb?code=1')).toBe(true);
    expect(isSafeRedirect('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirect('not a url')).toBe(false);
  });
});
