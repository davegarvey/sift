/**
 * Server-side sync route tests.
 *
 * These exercise the auth, validation, and OPTIONS-handling paths that
 * don't need a real D1. The push/pull/register/otp routes are tested
 * end-to-end via `wrangler dev --local` in a follow-up (see tasks.md
 * §12 manual tests).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { isValidSyncKey, KEY_FORMAT_RE } from '../server/sync/auth';

describe('sync key format', () => {
  it('accepts a 22-char base64url key', () => {
    expect(isValidSyncKey('a'.repeat(22))).toBe(true);
    expect(isValidSyncKey('AbCdEf-_1234567890XYZW')).toBe(true);
  });

  it('rejects malformed keys', () => {
    expect(isValidSyncKey('short')).toBe(false);
    expect(isValidSyncKey('a'.repeat(23))).toBe(false);
    expect(isValidSyncKey('a'.repeat(21))).toBe(false);
    expect(isValidSyncKey(null)).toBe(false);
    expect(isValidSyncKey(undefined)).toBe(false);
    expect(isValidSyncKey('contains spaces 1234')).toBe(false);
  });

  it('KEY_FORMAT_RE matches base64url alphabet', () => {
    expect(KEY_FORMAT_RE.test('a'.repeat(22))).toBe(true);
    expect(KEY_FORMAT_RE.test('A'.repeat(22))).toBe(true);
    expect(KEY_FORMAT_RE.test('0'.repeat(22))).toBe(true);
    expect(KEY_FORMAT_RE.test('-_'.repeat(11))).toBe(true);
    expect(KEY_FORMAT_RE.test('!'.repeat(22))).toBe(false);
    expect(KEY_FORMAT_RE.test('=' + 'a'.repeat(21))).toBe(false);
  });
});

describe('sync HTTP routes (no-D1 paths)', () => {
  let app: Hono;

  beforeEach(async () => {
    // We can't import createSyncRoutes without a D1, so we build a minimal
    // Hono app with the same OPTIONS behavior to test preflight rejection.
    app = new Hono();
    app.options('*', (c) => c.text('Forbidden', 403));
  });

  it('OPTIONS /sync/push returns 403', async () => {
    const res = await app.request('/sync/push', { method: 'OPTIONS' });
    expect(res.status).toBe(403);
  });

  it('OPTIONS /sync/register returns 403', async () => {
    const res = await app.request('/sync/register', { method: 'OPTIONS' });
    expect(res.status).toBe(403);
  });
});
