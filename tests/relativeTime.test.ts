import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../src/lib/relativeTime';

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-08-15T12:00:00Z');
  const iso = (msBefore: number) => new Date(NOW.getTime() - msBefore).toISOString();

  it('returns "just now" for a date less than 60 seconds ago', () => {
    expect(formatRelativeTime(iso(30_000), NOW)).toBe('just now');
  });

  it('returns "Xm ago" for a date less than 60 minutes ago', () => {
    expect(formatRelativeTime(iso(5 * 60_000), NOW)).toBe('5m ago');
  });

  it('returns "Xh ago" for a date less than 24 hours ago', () => {
    expect(formatRelativeTime(iso(3 * 3_600_000), NOW)).toBe('3h ago');
  });

  it('returns "Xd ago" for a date more than 24 hours ago', () => {
    expect(formatRelativeTime(iso(2 * 86_400_000), NOW)).toBe('2d ago');
  });

  it('rolls exactly-at-boundary elapsed times into the next bucket', () => {
    expect(formatRelativeTime(iso(60_000), NOW)).toBe('1m ago');
    expect(formatRelativeTime(iso(3_600_000), NOW)).toBe('1h ago');
    expect(formatRelativeTime(iso(86_400_000), NOW)).toBe('1d ago');
  });

  it('rounds up within the seconds bucket (59.6s -> "1m ago")', () => {
    expect(formatRelativeTime(iso(59_600), NOW)).toBe('1m ago');
  });

  it('rounds up within the hours bucket (23.6h -> "1d ago")', () => {
    expect(formatRelativeTime(iso(23.6 * 3_600_000), NOW)).toBe('1d ago');
  });

  it('uses the current time when now is omitted', () => {
    const fixture = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeTime(fixture)).toBe('just now');
  });

  it('throws RangeError for an unparseable date string', () => {
    expect(() => formatRelativeTime('garbage')).toThrow(RangeError);
  });

  it('throws RangeError for a non-ISO string Date.parse rejects', () => {
    expect(() => formatRelativeTime('15/08/2026')).toThrow(RangeError);
  });

  it('returns "just now" for a future date', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 30_000).toISOString(), NOW)).toBe('just now');
  });

  it('interprets a date-only string as local midnight', () => {
    const now = new Date(2026, 7, 15, 10, 0, 0);
    expect(formatRelativeTime('2026-08-15', now)).toBe('10h ago');
  });

  it('handles timestamps with a non-UTC offset as absolute instants', () => {
    expect(formatRelativeTime('2026-08-15T00:00:00+05:30', new Date('2026-08-15T10:00:00+05:30'))).toBe('10h ago');
  });

  it('accepts a rolled-over calendar date per Date.parse semantics', () => {
    const now = new Date(2026, 2, 3, 10, 0, 0);
    expect(formatRelativeTime('2026-02-31', now)).toBe('10h ago');
  });
});
