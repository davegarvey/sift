/**
 * QR code rendering tests.
 *
 * For now, just verify the function runs without error and returns a
 * non-empty SVG. A real decode test (with jsQR) is a v2 addition.
 */

import { describe, it, expect } from 'vitest';
import { renderSyncKeyQr } from '../src/sync/qr';

describe('renderSyncKeyQr', () => {
  it('returns a valid SVG for a 22-char key', () => {
    const svg = renderSyncKeyQr('a'.repeat(22));
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<rect');
  });

  it('uses currentColor for theme-friendly rendering', () => {
    const svg = renderSyncKeyQr('b'.repeat(22));
    expect(svg).toContain('fill="currentColor"');
  });
});
