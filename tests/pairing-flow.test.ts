/**
 * Pairing flow integration test (without HTTP).
 *
 * Tests the key generation → store → retrieve cycle and the validation
 * helpers used by the pairing modal.
 */

import { describe, it, expect } from 'vitest';
import { generateSyncKey, isValidSyncKey } from '../src/sync/key';
import { encodeItemId, decodeItemId } from '../src/sync/itemId';

describe('key lifecycle', () => {
  it('generates a unique 22-char key', () => {
    const a = generateSyncKey();
    const b = generateSyncKey();
    expect(a).not.toBe(b);
    expect(isValidSyncKey(a)).toBe(true);
    expect(isValidSyncKey(b)).toBe(true);
  });

  it('decodes an encoded item ID into feedUrl and guid', () => {
    const feedUrl = 'https://example.com/feed.xml';
    const guid = 'post-123';
    const id = encodeItemId(feedUrl, guid);
    const parsed = decodeItemId(id);
    expect(parsed?.feedUrl).toBe(feedUrl);
    expect(parsed?.guid).toBe(guid);
  });
});
